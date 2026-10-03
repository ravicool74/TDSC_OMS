"""Invoice PDF generation matching the TDSC reference layout."""
from io import BytesIO
from datetime import datetime
from pathlib import Path
from reportlab.lib.pagesizes import A4
from reportlab.lib import colors as rl_colors
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.lib.units import mm, cm
from reportlab.platypus import (
    SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle, KeepTogether, Image as RLImage
)
from reportlab.lib.enums import TA_LEFT, TA_RIGHT, TA_CENTER

LOGO_PATH = Path(__file__).resolve().parent / "assets" / "images" / "company-logo.jpg"

# ---- Company constants (as per reference PDF) ------------------------
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


# ---- Number to Indian words helper -----------------------------------
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


# ---- TrueType Font registration for genuine Rupee (₹) and Hindi support ----
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


# ---- Table helpers --------------------------------------------------
def _rupee(amt: float) -> str:
    if FONT_REG == "Helvetica":
        return f"Rs. {amt:,.2f}"
    return f"₹{amt:,.2f}"


def build_invoice_pdf(inv: dict, customer: dict | None = None) -> bytes:
    """Return PDF bytes for a Sale Invoice dict."""
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
    doc_title = ParagraphStyle("dt", parent=body, fontName=FONT_BOLD, fontSize=16, leading=18, alignment=TA_RIGHT, textColor=rl_colors.HexColor("#0F172A"))
    lbl_right = ParagraphStyle("lr", parent=small, fontName=FONT_REG, alignment=TA_RIGHT)
    lbl_left = ParagraphStyle("ll", parent=small, fontName=FONT_REG, alignment=TA_LEFT)
    bill_to = ParagraphStyle("bt", parent=body, fontName=FONT_BOLD, fontSize=10, backColor=rl_colors.HexColor("#EEF2FF"), borderPadding=4)

    elems = []

    # -------- Header: company (left) vs Tax Invoice + meta (right) ----
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
    meta_rows = [
        ["Invoice No.", str(inv.get("invoice_no") or "-")],
        ["Place of Supply", COMPANY["state"]],
        ["Date", inv.get("date") or "-"],
        ["Due Date", inv.get("due_date") or inv.get("date") or "-"],
    ]
    meta_tbl = Table(meta_rows, colWidths=[28 * mm, 40 * mm])
    meta_tbl.setStyle(TableStyle([
        ("FONTNAME", (0, 0), (-1, -1), FONT_REG),
        ("FONTSIZE", (0, 0), (-1, -1), 9),
        ("ALIGN", (0, 0), (0, -1), "LEFT"),
        ("ALIGN", (1, 0), (1, -1), "RIGHT"),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 3),
        ("TEXTCOLOR", (0, 0), (0, -1), rl_colors.HexColor("#475569")),
    ]))
    right_cell = [Paragraph("Tax Invoice", doc_title), Spacer(1, 4), meta_tbl]

    header_tbl = Table([[left_cell, right_cell]], colWidths=[110 * mm, 76 * mm])
    header_tbl.setStyle(TableStyle([
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("LEFTPADDING", (0, 0), (-1, -1), 0),
        ("RIGHTPADDING", (0, 0), (-1, -1), 0),
    ]))
    elems.append(header_tbl)
    elems.append(Spacer(1, 8))

    # -------- Bill To ----------------------------------------------------
    elems.append(Paragraph("Bill To", bill_to))
    bill_lines = [
        Paragraph(f"<b>{inv.get('party_name') or '-'}</b>", body),
    ]
    if customer:
        addr = customer.get("address") or ""
        if addr:
            bill_lines.append(Paragraph(addr, small))
    if inv.get("party_mobile"):
        bill_lines.append(Paragraph(f"<b>Contact No.:</b> {inv['party_mobile']}", small))
    if inv.get("party_gst"):
        bill_lines.append(Paragraph(f"<b>GSTIN:</b> {inv['party_gst']}", small))
    bill_lines.append(Paragraph(f"<b>State:</b> {COMPANY['state']}", small))
    elems.append(Table([[bill_lines]], colWidths=[186 * mm], style=TableStyle([
        ("BOX", (0, 0), (-1, -1), 0.4, rl_colors.HexColor("#CBD5E1")),
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("LEFTPADDING", (0, 0), (-1, -1), 6),
        ("RIGHTPADDING", (0, 0), (-1, -1), 6),
        ("TOPPADDING", (0, 0), (-1, -1), 4),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
    ])))
    elems.append(Spacer(1, 6))

    # -------- Items table -----------------------------------------------
    items = inv.get("items") or []
    header = ["#", "Item name", "HSN/SAC", "Quantity", "Price / Unit", "Amount"]
    rows = [header]
    total_qty = 0.0
    subtotal = 0.0
    for i, it in enumerate(items, 1):
        qty = float(it.get("qty") or 0)
        price = float(it.get("price") or 0)
        amt = float(it.get("amount") or 0)
        if amt == 0:
            after = max(0.0, qty * price - float(it.get("discount") or 0))
            amt = round(after * (1 + float(it.get("tax_rate") or 0) / 100.0), 2)
        total_qty += qty
        subtotal += amt
        rows.append([
            str(i), Paragraph(str(it.get("name") or ""), body),
            str(it.get("hsn_sac") or ""), f"{qty:g}",
            _rupee(price), _rupee(amt),
        ])
    if not items:
        rows.append(["1", Paragraph("Services", body), "", "1", _rupee(inv.get("total_amount") or 0), _rupee(inv.get("total_amount") or 0)])
        total_qty = 1
        subtotal = float(inv.get("total_amount") or 0)
    # Total row
    rows.append(["", Paragraph("<b>Total</b>", body), "", f"{total_qty:g}", "", _rupee(subtotal or float(inv.get("total_amount") or 0))])
    items_tbl = Table(rows, colWidths=[8 * mm, 66 * mm, 22 * mm, 22 * mm, 32 * mm, 36 * mm], repeatRows=1)
    items_tbl.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, 0), rl_colors.HexColor("#0F172A")),
        ("TEXTCOLOR", (0, 0), (-1, 0), rl_colors.white),
        ("FONTNAME", (0, 0), (-1, 0), FONT_BOLD),
        ("FONTSIZE", (0, 0), (-1, -1), 9),
        ("ALIGN", (0, 0), (0, -1), "CENTER"),
        ("ALIGN", (3, 0), (5, -1), "RIGHT"),
        ("ALIGN", (2, 0), (2, -1), "CENTER"),
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
        ("GRID", (0, 0), (-1, -1), 0.3, rl_colors.HexColor("#CBD5E1")),
        ("BACKGROUND", (0, -1), (-1, -1), rl_colors.HexColor("#F1F5F9")),
        ("FONTNAME", (0, -1), (-1, -1), FONT_BOLD),
    ]))
    elems.append(items_tbl)
    elems.append(Spacer(1, 6))

    # -------- Amount in Words + Amounts table (side by side) -----------
    total = float(inv.get("total_amount") or 0)
    paid = float(inv.get("paid_amount") or 0)
    balance = float(inv.get("balance") or 0)
    if not balance and total: balance = round(total - paid, 2)
    amounts_rows = [
        ["Sub Total", _rupee(total - float(inv.get("total_tax") or 0))],
        ["Total", _rupee(total)],
        ["Received", _rupee(paid)],
        ["Balance", _rupee(balance)],
    ]
    amounts_tbl = Table(amounts_rows, colWidths=[35 * mm, 40 * mm])
    amounts_tbl.setStyle(TableStyle([
        ("FONTNAME", (0, 0), (-1, -1), FONT_REG),
        ("FONTSIZE", (0, 0), (-1, -1), 10),
        ("ALIGN", (1, 0), (1, -1), "RIGHT"),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 3),
        ("LINEABOVE", (0, 1), (-1, 1), 0.3, rl_colors.HexColor("#CBD5E1")),
        ("LINEABOVE", (0, 3), (-1, 3), 0.4, rl_colors.HexColor("#0F172A")),
        ("FONTNAME", (0, 1), (-1, 1), FONT_BOLD),
        ("FONTNAME", (0, 3), (-1, 3), FONT_BOLD),
        ("TEXTCOLOR", (0, 3), (-1, 3), rl_colors.HexColor("#DC2626")),
    ]))
    words_para = Paragraph(
        f"<b>Invoice Amount In Words</b><br/>{number_to_indian_words(total)}",
        body,
    )
    words_tbl = Table([[words_para, amounts_tbl]], colWidths=[110 * mm, 76 * mm])
    words_tbl.setStyle(TableStyle([
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("LEFTPADDING", (0, 0), (-1, -1), 0),
        ("RIGHTPADDING", (0, 0), (-1, -1), 0),
    ]))
    elems.append(words_tbl)
    elems.append(Spacer(1, 6))

    # -------- Payments History / Receipts (if any) ---------------------
    payments = inv.get("payments") or []
    if payments and len(payments) > 0:
        pay_rows = [
            [
                Paragraph("<b>Date</b>", small),
                Paragraph("<b>Voucher / Receipt Ref</b>", small),
                Paragraph("<b>Mode & Type</b>", small),
                Paragraph("<b>Paid Amount</b>", small),
                Paragraph("<b>Balance Left</b>", small),
            ]
        ]
        for p in payments:
            pay_date = str(p.get("date") or "-")
            pno = str(p.get("payment_no") or "-")
            pmode = f"{str(p.get('payment_mode') or '').upper()} ({p.get('payment_type') or 'Payment'})"
            pamt = _rupee(float(p.get("amount") or 0))
            pbal = _rupee(float(p.get("balance_after") or 0))
            pay_rows.append([
                Paragraph(pay_date, small),
                Paragraph(pno, small),
                Paragraph(pmode, small),
                Paragraph(f"<b>{pamt}</b>", small),
                Paragraph(pbal, small),
            ])
        pay_tbl = Table(pay_rows, colWidths=[26 * mm, 46 * mm, 50 * mm, 32 * mm, 32 * mm])
        pay_tbl.setStyle(TableStyle([
            ("BACKGROUND", (0, 0), (-1, 0), rl_colors.HexColor("#F8FAFC")),
            ("BOX", (0, 0), (-1, -1), 0.3, rl_colors.HexColor("#CBD5E1")),
            ("INNERGRID", (0, 0), (-1, -1), 0.3, rl_colors.HexColor("#E2E8F0")),
            ("TOPPADDING", (0, 0), (-1, -1), 2.5),
            ("BOTTOMPADDING", (0, 0), (-1, -1), 2.5),
            ("ALIGN", (3, 0), (4, -1), "RIGHT"),
        ]))
        elems.append(Paragraph("<b>Payment Receipts & Timeline</b>", small))
        elems.append(Spacer(1, 2))
        elems.append(pay_tbl)
        elems.append(Spacer(1, 6))

    # -------- Notes + Terms + Signatory --------------------------------
    notes = inv.get("notes") or ""
    payment_type = (inv.get("payment_type") or "").upper()
    payment_mode = (inv.get("payment_mode") or "cash").replace("_", " ").title()
    desc_lines = [Paragraph("<b>Description</b>", small)]
    desc_lines.append(Paragraph(f"<b>Payment Mode:</b> {payment_mode}", small))
    if payment_type == "CASH":
        desc_lines.append(Paragraph("By Cash Denomination :-", small))
        try:
            n500 = int(paid // 500)
            if n500:
                desc_lines.append(Paragraph(f"By Cash - 500 x {n500}", small))
        except Exception:
            pass
    if notes:
        desc_lines.append(Paragraph(notes, small))

    terms_lines = [
        Paragraph("<b>Terms and conditions</b>", small),
        Paragraph("Thanks for doing business with us!", small),
    ]
    signatory_name = inv.get("signatory_name") or SIGNATORY
    if FONT_DEV in ("Helvetica-Bold", "Helvetica") and signatory_name == "अंजू कुमारी":
        signatory_name = "Anju Kumari"
    include_sig = inv.get("include_signature", True)
    signatory_lines = [
        Paragraph(f"For: <b>{COMPANY['name']}</b>", small),
    ]
    if include_sig:
        sig_url = inv.get("signature_url")
        sig_img_path = None
        if sig_url and "/api/invoices/signatures/" in sig_url:
            fname = sig_url.split("/")[-1]
            local_p = Path(__file__).resolve().parent / "uploads" / "signatures" / fname
            if local_p.exists():
                sig_img_path = local_p

        if sig_img_path:
            signatory_lines.append(Spacer(1, 4))
            try:
                signatory_lines.append(RLImage(str(sig_img_path), width=35 * mm, height=14 * mm))
            except Exception:
                pass
            signatory_lines.append(Spacer(1, 4))
        else:
            stamp_html = f"<font color='#059669'><b>✔ DIGITALLY VERIFIED</b></font><br/><font size='7' color='#64748B'>Authorized: {signatory_name}</font>"
            signatory_lines.append(Spacer(1, 8))
            signatory_lines.append(Paragraph(stamp_html, ParagraphStyle("stamp", parent=small, fontName=FONT_DEV, alignment=TA_RIGHT)))
            signatory_lines.append(Spacer(1, 4))
    else:
        signatory_lines.append(Spacer(1, 24))

    signatory_lines.append(Paragraph(f"<b>{signatory_name}</b>", ParagraphStyle("sig", parent=body, fontName=FONT_DEV, fontSize=10, alignment=TA_RIGHT)))
    signatory_lines.append(Paragraph("Authorized Signatory", ParagraphStyle("sig2", parent=small, fontName=FONT_REG, alignment=TA_RIGHT)))

    bottom_tbl = Table([[desc_lines, terms_lines, signatory_lines]],
                      colWidths=[70 * mm, 55 * mm, 61 * mm])
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
    elems.append(Spacer(1, 6))

    # -------- Bank details ---------------------------------------------
    bank_para = [
        Paragraph("<b>Bank Details</b>", small),
        Paragraph(f"<b>Name:</b> {BANK['name']}", small),
        Paragraph(f"<b>Account No.:</b> {BANK['account_no']}", small),
        Paragraph(f"<b>IFSC code:</b> {BANK['ifsc']}", small),
        Paragraph(f"<b>Account Holder's Name:</b> {BANK['holder']}", small),
    ]
    bank_tbl = Table([[bank_para]], colWidths=[186 * mm])
    bank_tbl.setStyle(TableStyle([
        ("BOX", (0, 0), (-1, -1), 0.4, rl_colors.HexColor("#CBD5E1")),
        ("BACKGROUND", (0, 0), (-1, -1), rl_colors.HexColor("#F8FAFC")),
        ("LEFTPADDING", (0, 0), (-1, -1), 6),
        ("RIGHTPADDING", (0, 0), (-1, -1), 6),
        ("TOPPADDING", (0, 0), (-1, -1), 6),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 6),
    ]))
    elems.append(bank_tbl)

    doc.build(elems)
    return buf.getvalue()
