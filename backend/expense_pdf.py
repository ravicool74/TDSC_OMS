"""Payment / Expense Voucher PDF generation matching official TDSC layout."""
import os
from io import BytesIO
from datetime import datetime
from pathlib import Path
from reportlab.lib.pagesizes import A4
from reportlab.lib import colors as rl_colors
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.lib.units import mm
from reportlab.platypus import (
    SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle, KeepTogether, Image as RLImage
)
from reportlab.lib.enums import TA_LEFT, TA_RIGHT, TA_CENTER
from reportlab.pdfgen import canvas
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont

LOGO_PATH = Path(__file__).resolve().parent / "assets" / "images" / "company-logo.jpg"

COMPANY = {
    "name": "TRIVENI DSC AND ETENDER SERVICE PVT. LTD",
    "address_l1": "MOH-BHAISHASUR HOSPITAL MORE NEAR EYE CARE HOSPITAL SRI",
    "address_l2": "DILCHANDRA MAHTO WARD NO-17 RANCHI ROAD BIHARSHARIF",
    "phone": "9334344708",
    "email": "tdscservice@gmail.com",
    "gstin": "10AAGCT3865R1ZU",
    "state": "10-Bihar",
}
SIGNATORY = "अंजू कुमारी"

_ONES = ["", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine",
         "Ten", "Eleven", "Twelve", "Thirteen", "Fourteen", "Fifteen", "Sixteen",
         "Seventeen", "Eighteen", "Nineteen"]
_TENS = ["", "", "Twenty", "Thirty", "Forty", "Fifty", "Sixty", "Seventy", "Eighty", "Ninety"]

def _two(n: int) -> str:
    if n < 20: return _ONES[n]
    return _TENS[n // 10] + (" " + _ONES[n % 10] if n % 10 else "")

def _three(n: int) -> str:
    if n >= 100:
        return _ONES[n // 100] + " Hundred" + ((" " + _two(n % 100)) if n % 100 else "")
    return _two(n)

def number_to_indian_words(n: float) -> str:
    n = int(round(n))
    if n == 0: return "Zero Rupees only"
    parts = []
    crore = n // 10000000; n %= 10000000
    lakh = n // 100000; n %= 100000
    thousand = n // 1000; n %= 1000
    hundred = n
    if crore: parts.append(_two(crore) + " Crore")
    if lakh: parts.append(_two(lakh) + " Lakh")
    if thousand: parts.append(_two(thousand) + " Thousand")
    if hundred: parts.append(_three(hundred))
    return " ".join(parts).strip() + " Rupees only"

FONT_REG = "Helvetica"
FONT_BOLD = "Helvetica-Bold"
FONT_DEV = "Helvetica-Bold"

try:
    search_dirs = [
        os.environ.get("WINDIR", r"C:\Windows") + r"\Fonts",
        "/usr/share/fonts/truetype/dejavu",
        "/usr/share/fonts/truetype/liberation",
        "/usr/share/fonts/truetype/freefont",
        "/usr/share/fonts/truetype",
    ]
    for d in search_dirs:
        segoe_path = os.path.join(d, "segoeui.ttf")
        segoeb_path = os.path.join(d, "segoeuib.ttf")
        if os.path.exists(segoe_path) and os.path.exists(segoeb_path):
            pdfmetrics.registerFont(TTFont("SegoeUI", segoe_path))
            pdfmetrics.registerFont(TTFont("SegoeUI-Bold", segoeb_path))
            FONT_REG = "SegoeUI"
            FONT_BOLD = "SegoeUI-Bold"
            break
        deja_path = os.path.join(d, "DejaVuSans.ttf")
        dejab_path = os.path.join(d, "DejaVuSans-Bold.ttf")
        if os.path.exists(deja_path) and os.path.exists(dejab_path):
            pdfmetrics.registerFont(TTFont("DejaVuSans", deja_path))
            pdfmetrics.registerFont(TTFont("DejaVuSans-Bold", dejab_path))
            FONT_REG = "DejaVuSans"
            FONT_BOLD = "DejaVuSans-Bold"
            break

    for d in search_dirs:
        for fname in ["Nirmala.ttf", "Nirmala.ttc", "Lohit-Devanagari.ttf", "gargi.ttf"]:
            p = os.path.join(d, fname)
            if os.path.exists(p):
                pdfmetrics.registerFont(TTFont("DevFont", p, subfontIndex=0 if fname.endswith(".ttc") else None))
                FONT_DEV = "DevFont"
                break
        if FONT_DEV != "Helvetica-Bold":
            break
    if FONT_DEV == "Helvetica-Bold":
        FONT_DEV = FONT_BOLD
except Exception:
    FONT_DEV = FONT_BOLD

def _rupee(amt: float) -> str:
    if FONT_REG == "Helvetica":
        return f"Rs. {amt:,.2f}"
    return f"₹{amt:,.2f}"

def build_expense_pdf(exp: dict, customer: dict | None = None) -> bytes:
    """Return official PDF voucher bytes for an Expense."""
    buf = BytesIO()
    doc = SimpleDocTemplate(
        buf, pagesize=A4,
        leftMargin=12 * mm, rightMargin=12 * mm,
        topMargin=10 * mm, bottomMargin=10 * mm,
    )

    styles = getSampleStyleSheet()
    body = ParagraphStyle("body", parent=styles["BodyText"], fontName=FONT_REG, fontSize=9, leading=11)
    small = ParagraphStyle("small", parent=body, fontName=FONT_REG, fontSize=8, leading=10)
    company_hdr = ParagraphStyle("ch", parent=body, fontName=FONT_BOLD, fontSize=13, leading=15, textColor=rl_colors.HexColor("#0F172A"))
    doc_title = ParagraphStyle("dt", parent=body, fontName=FONT_BOLD, fontSize=15, leading=17, alignment=TA_RIGHT, textColor=rl_colors.HexColor("#DC2626"))
    box_hdr = ParagraphStyle("bh", parent=body, fontName=FONT_BOLD, fontSize=9, backColor=rl_colors.HexColor("#FEF2F2"), borderPadding=4)

    elems = []

    # 1. Header: Company Info + Logo + Title
    logo_elem = None
    if LOGO_PATH.exists():
        try:
            logo_elem = RLImage(str(LOGO_PATH), width=20 * mm, height=20 * mm)
        except Exception:
            logo_elem = None

    company_lines = [
        Paragraph(COMPANY["name"], company_hdr),
        Paragraph(COMPANY["address_l1"], small),
        Paragraph(COMPANY["address_l2"], small),
        Paragraph(f"<b>Phone:</b> {COMPANY['phone']} &nbsp;|&nbsp; <b>Email:</b> {COMPANY['email']}", small),
        Paragraph(f"<b>GSTIN:</b> {COMPANY['gstin']} &nbsp;|&nbsp; <b>State:</b> {COMPANY['state']}", small),
    ]

    if logo_elem:
        left_sub_tbl = Table([[logo_elem, company_lines]], colWidths=[24 * mm, 86 * mm])
        left_sub_tbl.setStyle(TableStyle([
            ("VALIGN", (0, 0), (-1, -1), "TOP"),
            ("LEFTPADDING", (0, 0), (-1, -1), 0),
            ("RIGHTPADDING", (0, 0), (-1, -1), 0),
            ("TOPPADDING", (0, 0), (-1, -1), 0),
            ("BOTTOMPADDING", (0, 0), (-1, -1), 0),
        ]))
        left_cell = [left_sub_tbl]
    else:
        left_cell = company_lines

    exp_no = exp.get("expense_no") or "EXP-0001"
    meta_rows = [
        ["Expense Voucher No.", exp_no],
        ["Voucher Date", str(exp.get("date") or "-")],
        ["Category", str(exp.get("category") or "General")],
        ["Payment Mode", str(exp.get("payment_mode") or "CASH").upper()],
        ["Status", str(exp.get("status") or "APPROVED").upper()],
    ]
    meta_tbl = Table(meta_rows, colWidths=[35 * mm, 33 * mm])
    meta_tbl.setStyle(TableStyle([
        ("FONTNAME", (0, 0), (-1, -1), FONT_REG),
        ("FONTSIZE", (0, 0), (-1, -1), 9),
        ("ALIGN", (0, 0), (0, -1), "LEFT"),
        ("ALIGN", (1, 0), (1, -1), "RIGHT"),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 3),
        ("TEXTCOLOR", (0, 0), (0, -1), rl_colors.HexColor("#475569")),
        ("FONTNAME", (1, 0), (1, 0), FONT_BOLD),
        ("TEXTCOLOR", (1, 0), (1, 0), rl_colors.HexColor("#DC2626")),
    ]))
    right_cell = [Paragraph("EXPENSE VOUCHER", doc_title), Spacer(1, 4), meta_tbl]

    header_tbl = Table([[left_cell, right_cell]], colWidths=[118 * mm, 68 * mm])
    header_tbl.setStyle(TableStyle([
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("LINEBELOW", (0, 0), (-1, -1), 0.5, rl_colors.HexColor("#CBD5E1")),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 8),
    ]))
    elems.append(header_tbl)
    elems.append(Spacer(1, 6))

    # 2. Beneficiary (Paid To) & Customer / Job Box
    cust_data = customer or {}
    cust_name = exp.get("customer_name") or cust_data.get("name") or "-"
    cust_code = exp.get("customer_code") or cust_data.get("customer_code") or ""
    cust_mobile = exp.get("customer_mobile") or cust_data.get("mobile") or "-"
    cust_gst = exp.get("customer_gst") or cust_data.get("gst_no") or "-"
    cust_pan = exp.get("customer_pan") or cust_data.get("pan") or "-"
    vendor = exp.get("vendor") or "Cash / Self / Beneficiary"
    sale_inv = exp.get("sale_invoice_no") or "-"
    pass_on_item = exp.get("sale_item_name") or "-"

    info_rows = [
        [
            Paragraph("<b>PAID TO / VENDOR DETAILS</b>", box_hdr),
            Paragraph("<b>CUSTOMER / JOB DETAILS</b>", box_hdr)
        ],
        [
            Paragraph(
                f"<b>Beneficiary / Vendor:</b> {vendor}<br/>"
                f"<b>Payment Mode:</b> {str(exp.get('payment_mode') or 'cash').upper()}<br/>"
                f"<b>Booked By:</b> {exp.get('created_by_name') or 'Admin'}<br/>"
                f"<b>Voucher Status:</b> {str(exp.get('status') or 'pending').upper()}",
                small
            ),
            Paragraph(
                f"<b>Customer:</b> {cust_name} {f'({cust_code})' if cust_code else ''}<br/>"
                f"<b>Mobile:</b> {cust_mobile} &nbsp;|&nbsp; <b>PAN:</b> {cust_pan}<br/>"
                f"<b>GSTIN:</b> {cust_gst}<br/>"
                f"<b>Linked Sale Voucher:</b> {sale_inv} {f'• {pass_on_item}' if pass_on_item != '-' else ''}",
                small
            )
        ]
    ]
    party_tbl = Table(info_rows, colWidths=[93 * mm, 93 * mm])
    party_tbl.setStyle(TableStyle([
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("BOX", (0, 0), (-1, -1), 0.3, rl_colors.HexColor("#CBD5E1")),
        ("INNERGRID", (0, 0), (-1, -1), 0.3, rl_colors.HexColor("#E2E8F0")),
        ("LEFTPADDING", (0, 0), (-1, -1), 6),
        ("RIGHTPADDING", (0, 0), (-1, -1), 6),
        ("TOPPADDING", (0, 0), (-1, -1), 4),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
    ]))
    elems.append(party_tbl)
    elems.append(Spacer(1, 8))

    # 3. Particulars Table
    items_header = [
        Paragraph("<b>Sl.</b>", small),
        Paragraph("<b>Category & Particulars</b>", small),
        Paragraph("<b>Reference / Remarks</b>", small),
        Paragraph("<b>Amount (INR)</b>", small)
    ]
    amt = float(exp.get("amount") or 0.0)
    items_data = [items_header]

    part_text = f"<b>{exp.get('category') or 'Expense'}</b>"
    if exp.get("sale_item_name"):
        part_text += f"<br/><font color='#475569'>Passed On Item: {exp.get('sale_item_name')}</font>"
    if exp.get("sale_invoice_no"):
        part_text += f"<br/><font color='#0284C7'>Against Sale Voucher: {exp.get('sale_invoice_no')}</font>"

    desc_text = exp.get("description") or "-"

    items_data.append([
        Paragraph("1", small),
        Paragraph(part_text, small),
        Paragraph(desc_text, small),
        Paragraph(f"<b>{_rupee(amt)}</b>", small),
    ])

    items_tbl = Table(items_data, colWidths=[10 * mm, 80 * mm, 60 * mm, 36 * mm])
    items_tbl.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, 0), rl_colors.HexColor("#F1F5F9")),
        ("BOX", (0, 0), (-1, -1), 0.5, rl_colors.HexColor("#CBD5E1")),
        ("INNERGRID", (0, 0), (-1, -1), 0.3, rl_colors.HexColor("#E2E8F0")),
        ("ALIGN", (0, 0), (0, -1), "CENTER"),
        ("ALIGN", (-1, 0), (-1, -1), "RIGHT"),
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
        ("TOPPADDING", (0, 0), (-1, -1), 6),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 6),
    ]))
    elems.append(items_tbl)
    elems.append(Spacer(1, 6))

    # 4. Total and Amount in Words
    words = number_to_indian_words(amt)
    summary_data = [
        [
            Paragraph(f"<b>Amount in Words:</b><br/><i>{words}</i>", small),
            Paragraph(f"<b>TOTAL EXPENSE:</b>", ParagraphStyle("totlbl", parent=body, fontName=FONT_BOLD, alignment=TA_RIGHT, fontSize=10)),
            Paragraph(f"<b>{_rupee(amt)}</b>", ParagraphStyle("totval", parent=body, fontName=FONT_BOLD, alignment=TA_RIGHT, textColor=rl_colors.HexColor("#DC2626"), fontSize=13))
        ]
    ]
    summary_tbl = Table(summary_data, colWidths=[100 * mm, 46 * mm, 40 * mm])
    summary_tbl.setStyle(TableStyle([
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
        ("BOX", (0, 0), (-1, -1), 0.5, rl_colors.HexColor("#CBD5E1")),
        ("BACKGROUND", (0, 0), (-1, -1), rl_colors.HexColor("#F8FAFC")),
        ("TOPPADDING", (0, 0), (-1, -1), 8),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 8),
        ("LEFTPADDING", (0, 0), (-1, -1), 6),
        ("RIGHTPADDING", (0, 0), (-1, -1), 6),
    ]))
    elems.append(summary_tbl)
    elems.append(Spacer(1, 14))

    sig_label = "Anju Kumari" if FONT_DEV in ("Helvetica-Bold", "Helvetica") and SIGNATORY == "अंजू कुमारी" else SIGNATORY
    sig_block = [
        Paragraph(sig_label, ParagraphStyle("sig_dev", parent=body, fontName=FONT_DEV, fontSize=13, alignment=TA_CENTER, textColor=rl_colors.HexColor("#0F172A"))),
        Paragraph("Authorized Signatory", ParagraphStyle("sig_sub", parent=body, fontName=FONT_BOLD, fontSize=9, alignment=TA_CENTER, textColor=rl_colors.HexColor("#64748B"))),
        Paragraph(f"For {COMPANY['name']}", ParagraphStyle("sig_co", parent=body, fontName=FONT_REG, fontSize=8, alignment=TA_CENTER, textColor=rl_colors.HexColor("#94A3B8"))),
    ]

    veri_block = [
        Paragraph("<b>✔ OFFICIAL PAYMENT VOUCHER</b>", ParagraphStyle("v1", parent=body, fontName=FONT_BOLD, fontSize=10, textColor=rl_colors.HexColor("#DC2626"), alignment=TA_CENTER)),
        Paragraph("Checked & Verified for TDSC Accounts Record", ParagraphStyle("v2", parent=body, fontName=FONT_REG, fontSize=8, textColor=rl_colors.HexColor("#991B1B"), alignment=TA_CENTER)),
        Paragraph(f"Verified by: {exp.get('verified_by') or 'Accounts Officer'}", ParagraphStyle("v3", parent=body, fontName=FONT_REG, fontSize=8, textColor=rl_colors.HexColor("#7F1D1D"), alignment=TA_CENTER)),
    ]

    footer_tbl = Table([[veri_block, sig_block]], colWidths=[93 * mm, 93 * mm])
    footer_tbl.setStyle(TableStyle([
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("LINEABOVE", (0, 0), (-1, -1), 0.5, rl_colors.HexColor("#CBD5E1")),
        ("TOPPADDING", (0, 0), (-1, -1), 12),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 6),
    ]))
    elems.append(KeepTogether(footer_tbl))

    doc.build(elems)
    return buf.getvalue()
