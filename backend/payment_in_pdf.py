"""Payment-In (Add Income) Receipt / Voucher PDF generation matching official TDSC layout."""
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
BANK = {
    "name": "STATE BANK OF INDIA, SME BIHARSHARIFF",
    "account_no": "42137607814",
    "ifsc": "SBIN0063706",
    "holder": "TRIVENI DSC AND E TENDER SERVICE PVT.LTD",
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
    import os
    from reportlab.pdfbase import pdfmetrics
    from reportlab.pdfbase.ttfonts import TTFont

    search_dirs = [
        os.environ.get("WINDIR", "C:\\Windows") + "\\Fonts",
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
        for fname in ["Nirmala.ttc", "Nirmala.ttf", "Lohit-Devanagari.ttf", "gargi.ttf"]:
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
    pass

def _rupee(amt: float) -> str:
    if FONT_REG == "Helvetica":
        return f"Rs. {amt:,.2f}"
    return f"₹{amt:,.2f}"

def build_payment_in_pdf(inc: dict, customer: dict | None = None) -> bytes:
    """Return official PDF receipt bytes for a Payment-In voucher."""
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
    doc_title = ParagraphStyle("dt", parent=body, fontName=FONT_BOLD, fontSize=15, leading=17, alignment=TA_RIGHT, textColor=rl_colors.HexColor("#047857"))
    bill_to = ParagraphStyle("bt", parent=body, fontName=FONT_BOLD, fontSize=10, backColor=rl_colors.HexColor("#ECFDF5"), borderPadding=4)

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

    v_no = inc.get("voucher_no") or inc.get("income_no") or "PAYIN-0001"
    meta_rows = [
        ["Receipt No.", v_no],
        ["Receipt Date", str(inc.get("date") or "-")],
        ["Payment Mode", str(inc.get("payment_mode") or "CASH").upper()],
        ["Service Cat.", str(inc.get("service_category") or "General")],
    ]
    meta_tbl = Table(meta_rows, colWidths=[28 * mm, 40 * mm])
    meta_tbl.setStyle(TableStyle([
        ("FONTNAME", (0, 0), (-1, -1), FONT_REG),
        ("FONTSIZE", (0, 0), (-1, -1), 9),
        ("ALIGN", (0, 0), (0, -1), "LEFT"),
        ("ALIGN", (1, 0), (1, -1), "RIGHT"),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 3),
        ("TEXTCOLOR", (0, 0), (0, -1), rl_colors.HexColor("#475569")),
        ("FONTNAME", (1, 0), (1, 0), FONT_BOLD),
        ("TEXTCOLOR", (1, 0), (1, 0), rl_colors.HexColor("#047857")),
    ]))
    right_cell = [Paragraph("Payment-In Receipt", doc_title), Spacer(1, 4), meta_tbl]

    header_tbl = Table([[left_cell, right_cell]], colWidths=[110 * mm, 76 * mm])
    header_tbl.setStyle(TableStyle([
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("LINEBELOW", (0, 0), (-1, -1), 0.5, rl_colors.HexColor("#CBD5E1")),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 8),
    ]))
    elems.append(header_tbl)
    elems.append(Spacer(1, 6))

    # 2. Customer / Received From Box
    cust_data = customer or {}
    cust_name = inc.get("client_name") or cust_data.get("name") or "Customer"
    cust_code = cust_data.get("customer_code") or ""
    cust_mobile = inc.get("client_mobile") or cust_data.get("mobile") or "-"
    cust_gst = cust_data.get("gst_no") or "-"
    cust_pan = cust_data.get("pan") or "-"
    cust_addr = cust_data.get("address") or "-"

    cust_rows = [
        [
            Paragraph("<b>RECEIVED WITH THANKS FROM</b>", bill_to),
            Paragraph("<b>RECEIPT SUMMARY</b>", bill_to)
        ],
        [
            Paragraph(
                f"<b>{cust_name}</b> {f'({cust_code})' if cust_code else ''}<br/>"
                f"<b>Mobile:</b> {cust_mobile} &nbsp;|&nbsp; <b>GSTIN:</b> {cust_gst}<br/>"
                f"<b>PAN:</b> {cust_pan}<br/>"
                f"<b>Address:</b> {cust_addr}",
                small
            ),
            Paragraph(
                f"<b>Total Received:</b> <font color='#047857' size='11'><b>{_rupee(float(inc.get('amount') or 0))}</b></font><br/>"
                f"<b>Mode:</b> {str(inc.get('payment_mode') or 'cash').upper()}<br/>"
                f"<b>Received By:</b> {inc.get('employee_name') or 'Accounts Desk'}<br/>"
                f"<b>Ref / Remarks:</b> {inc.get('remarks') or '-'}",
                small
            )
        ]
    ]
    party_tbl = Table(cust_rows, colWidths=[110 * mm, 76 * mm])
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

    # 3. Particulars / Items Table
    raw_items = inc.get("items") or []
    if not raw_items:
        raw_items = [{
            "sl": 1,
            "item": inc.get("service_name") or inc.get("service_category") or "Payment-In Received",
            "qty": 1,
            "rate": float(inc.get("amount") or 0),
            "amount": float(inc.get("amount") or 0),
        }]

    items_header = [
        Paragraph("<b>Sl.</b>", small),
        Paragraph("<b>Particulars / Service Description</b>", small),
        Paragraph("<b>Qty</b>", small),
        Paragraph("<b>Rate (₹)</b>", small),
        Paragraph("<b>Amount (₹)</b>", small),
    ]
    item_rows = [items_header]
    for idx, it in enumerate(raw_items, 1):
        sl = it.get("sl") or idx
        name = it.get("item") or it.get("name") or "Service Payment"
        qty = it.get("qty", 1)
        rate = float(it.get("rate") or it.get("price") or 0)
        amt = float(it.get("amount") or 0)
        item_rows.append([
            Paragraph(str(sl), small),
            Paragraph(name, small),
            Paragraph(str(qty), small),
            Paragraph(f"{rate:,.2f}", small),
            Paragraph(f"<b>{amt:,.2f}</b>", small),
        ])

    items_tbl = Table(item_rows, colWidths=[12 * mm, 98 * mm, 20 * mm, 28 * mm, 28 * mm])
    items_tbl.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, 0), rl_colors.HexColor("#F1F5F9")),
        ("ALIGN", (0, 0), (0, -1), "CENTER"),
        ("ALIGN", (2, 0), (2, -1), "CENTER"),
        ("ALIGN", (3, 0), (-1, -1), "RIGHT"),
        ("BOX", (0, 0), (-1, -1), 0.3, rl_colors.HexColor("#CBD5E1")),
        ("INNERGRID", (0, 0), (-1, -1), 0.3, rl_colors.HexColor("#E2E8F0")),
        ("TOPPADDING", (0, 0), (-1, -1), 4),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
        ("LEFTPADDING", (0, 0), (-1, -1), 4),
        ("RIGHTPADDING", (0, 0), (-1, -1), 4),
    ]))
    elems.append(Paragraph("<b>PARTICULARS / PAYMENT BREAKDOWN</b>", small))
    elems.append(Spacer(1, 3))
    elems.append(items_tbl)
    elems.append(Spacer(1, 8))

    # 4. Linked Sale Vouchers Reconciliation Table (if any linked)
    linked = inc.get("linked_vouchers") or []
    if linked and len(linked) > 0:
        link_header = [
            Paragraph("<b>Sale Voucher No.</b>", small),
            Paragraph("<b>Voucher Date</b>", small),
            Paragraph("<b>Total Bill (₹)</b>", small),
            Paragraph("<b>Already Paid (₹)</b>", small),
            Paragraph("<b>Amount Linked (₹)</b>", small),
            Paragraph("<b>Remaining Balance (₹)</b>", small),
        ]
        link_rows = [link_header]
        for lv in linked:
            tot = float(lv.get("total_amount") or 0)
            prev = float(lv.get("previous_paid") or 0)
            alloc = float(lv.get("allocated_amount") or 0)
            rem = max(0.0, round(tot - (prev + alloc), 2))
            link_rows.append([
                Paragraph(f"<b>{lv.get('voucher_no')}</b>", small),
                Paragraph(str(lv.get("voucher_date") or "-"), small),
                Paragraph(f"{tot:,.2f}", small),
                Paragraph(f"{prev:,.2f}", small),
                Paragraph(f"<font color='#047857'><b>+{alloc:,.2f}</b></font>", small),
                Paragraph(f"<font color='{'#DC2626' if rem > 0 else '#047857'}'><b>{rem:,.2f}</b></font>", small),
            ])

        link_tbl = Table(link_rows, colWidths=[36 * mm, 26 * mm, 30 * mm, 30 * mm, 32 * mm, 32 * mm])
        link_tbl.setStyle(TableStyle([
            ("BACKGROUND", (0, 0), (-1, 0), rl_colors.HexColor("#ECFDF5")),
            ("ALIGN", (2, 0), (-1, -1), "RIGHT"),
            ("BOX", (0, 0), (-1, -1), 0.3, rl_colors.HexColor("#A7F3D0")),
            ("INNERGRID", (0, 0), (-1, -1), 0.3, rl_colors.HexColor("#D1FAE5")),
            ("TOPPADDING", (0, 0), (-1, -1), 3),
            ("BOTTOMPADDING", (0, 0), (-1, -1), 3),
            ("LEFTPADDING", (0, 0), (-1, -1), 4),
            ("RIGHTPADDING", (0, 0), (-1, -1), 4),
        ]))
        elems.append(Paragraph("<b>ADJUSTMENT / LINKING AGAINST SALE VOUCHERS</b>", small))
        elems.append(Spacer(1, 3))
        elems.append(link_tbl)
        elems.append(Spacer(1, 8))

    # 5. Total Received in Words & Numbers Table
    tot_amt = float(inc.get("amount") or 0)
    words_para = Paragraph(
        f"<b>Amount in Words:</b><br/>{number_to_indian_words(tot_amt)}",
        body
    )
    amt_summary_rows = [
        ["Total Amount Received", _rupee(tot_amt)],
    ]
    amt_summary_tbl = Table(amt_summary_rows, colWidths=[40 * mm, 36 * mm])
    amt_summary_tbl.setStyle(TableStyle([
        ("FONTNAME", (0, 0), (-1, -1), FONT_BOLD),
        ("FONTSIZE", (0, 0), (-1, -1), 11),
        ("ALIGN", (1, 0), (1, -1), "RIGHT"),
        ("TEXTCOLOR", (1, 0), (1, -1), rl_colors.HexColor("#047857")),
        ("LINEBELOW", (0, 0), (-1, -1), 1, rl_colors.HexColor("#047857")),
        ("TOPPADDING", (0, 0), (-1, -1), 6),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 6),
    ]))

    words_tbl = Table([[words_para, amt_summary_tbl]], colWidths=[110 * mm, 76 * mm])
    words_tbl.setStyle(TableStyle([
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("LEFTPADDING", (0, 0), (-1, -1), 0),
        ("RIGHTPADDING", (0, 0), (-1, -1), 0),
    ]))
    elems.append(words_tbl)
    elems.append(Spacer(1, 10))

    # 6. Bottom Signatory & Verification Block
    terms_para = Paragraph(
        "<b>Terms & Acknowledgement:</b><br/>"
        "• This is a computer generated official payment receipt.<br/>"
        "• Subject to realization in case of Cheque/Online Transfer.<br/>"
        "• Thank you for your business with TRIVENI DSC & E-TENDER SERVICE.",
        small
    )

    signatory_lines = [
        Paragraph(f"For: <b>{COMPANY['name']}</b>", small),
        Spacer(1, 4),
        Paragraph("<font color='#047857'><b>✔ DIGITALLY VERIFIED VOUCHER</b></font><br/><font size='7' color='#64748B'>Authorized Payment Collector</font>", small),
        Spacer(1, 12),
        Paragraph(f"<b>{'Anju Kumari' if FONT_DEV in ('Helvetica-Bold', 'Helvetica') and SIGNATORY == 'अंजू कुमारी' else SIGNATORY}</b>", ParagraphStyle("sig", parent=body, fontName=FONT_DEV, fontSize=10, alignment=TA_RIGHT)),
        Paragraph("Authorized Signatory", ParagraphStyle("sig2", parent=small, fontName=FONT_REG, alignment=TA_RIGHT)),
    ]

    bottom_tbl = Table([[terms_para, signatory_lines]], colWidths=[110 * mm, 76 * mm])
    bottom_tbl.setStyle(TableStyle([
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("BOX", (0, 0), (-1, -1), 0.3, rl_colors.HexColor("#CBD5E1")),
        ("INNERGRID", (0, 0), (-1, -1), 0.3, rl_colors.HexColor("#E2E8F0")),
        ("LEFTPADDING", (0, 0), (-1, -1), 6),
        ("RIGHTPADDING", (0, 0), (-1, -1), 6),
        ("TOPPADDING", (0, 0), (-1, -1), 6),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 6),
    ]))
    elems.append(bottom_tbl)

    doc.build(elems)
    return buf.getvalue()
