import re
from datetime import datetime
from io import BytesIO
from reportlab.lib.pagesizes import A4, landscape
from reportlab.pdfgen import canvas
from reportlab.lib import colors as rl_colors
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import mm
from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle

COMPANY = "TRIVENI DSC AND ETENDER SERVICE PVT. LTD"


def format_dsc_datetime(val) -> str:
    """Format date/datetime as 'Friday, 10 April, 2026 12:21:10 AM'."""
    if not val:
        return "—"
    s = str(val).strip()
    if not s or s in ("—", "NA", "None", "null", "undefined"):
        return "—"

    # If already formatted like 'Friday, 10 April, 2026 12:21:10 AM'
    pattern = r"^[A-Za-z]+,\s+\d{1,2}\s+[A-Za-z]+,\s+\d{4}\s+\d{1,2}:\d{2}:\d{2}\s+[AP]M$"
    if re.match(pattern, s, re.IGNORECASE):
        return s

    dt = None
    formats = [
        "%A, %d %B, %Y %I:%M:%S %p",
        "%A, %d %b, %Y %I:%M:%S %p",
        "%d %B, %Y %I:%M:%S %p",
        "%Y-%m-%d %H:%M:%S",
        "%Y-%m-%dT%H:%M:%S",
        "%Y-%m-%dT%H:%M:%S.%f",
        "%Y-%m-%d %I:%M:%S %p",
        "%Y-%m-%d",
        "%d-%m-%Y %H:%M:%S",
        "%d-%m-%Y %I:%M:%S %p",
        "%d-%m-%Y",
        "%d/%m/%Y %H:%M:%S",
        "%d/%m/%Y %I:%M:%S %p",
        "%d/%m/%Y",
    ]
    for fmt in formats:
        try:
            dt = datetime.strptime(s, fmt)
            break
        except Exception:
            pass

    if not dt:
        m = re.search(r"(\d{4})-(\d{2})-(\d{2})", s)
        if m:
            dt = datetime(int(m.group(1)), int(m.group(2)), int(m.group(3)), 12, 0, 0)
        else:
            m = re.search(r"(\d{1,2})[-/](\d{1,2})[-/](\d{4})", s)
            if m:
                dt = datetime(int(m.group(3)), int(m.group(2)), int(m.group(1)), 12, 0, 0)

    if dt:
        dow = dt.strftime("%A")
        day_num = dt.day
        month_name = dt.strftime("%B")
        year_num = dt.year
        time_part = dt.strftime("%I:%M:%S %p")
        return f"{dow}, {day_num} {month_name}, {year_num} {time_part}"

    return s


def _kv(label, value):
    return [Paragraph(f"<b>{label}</b>", _lbl), Paragraph(str(value) if value not in (None, "", "NA") else "—", _val)]


_styles = getSampleStyleSheet()
_body = ParagraphStyle("body", parent=_styles["BodyText"], fontName="Helvetica", fontSize=9, leading=11)
_lbl = ParagraphStyle("lbl", parent=_body, textColor=rl_colors.HexColor("#475569"), fontSize=8)
_val = ParagraphStyle("val", parent=_body, fontName="Helvetica-Bold", fontSize=9)
_h1 = ParagraphStyle("h1", parent=_body, fontName="Helvetica-Bold", fontSize=15, textColor=rl_colors.HexColor("#0F172A"))
_h2 = ParagraphStyle("h2", parent=_body, fontName="Helvetica-Bold", fontSize=11, textColor=rl_colors.white)
_sec = ParagraphStyle("sec", parent=_body, fontName="Helvetica-Bold", fontSize=10, textColor=rl_colors.HexColor("#1E40AF"))


def _section(title):
    t = Table([[Paragraph(title, _h2)]], colWidths=[186 * mm])
    t.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, -1), rl_colors.HexColor("#1E40AF")),
        ("LEFTPADDING", (0, 0), (-1, -1), 8),
        ("TOPPADDING", (0, 0), (-1, -1), 5),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 5),
    ]))
    return t


def _grid(pairs):
    """pairs: [(label,value), ...] rendered as 2-column table."""
    rows = []
    row = []
    for kv in pairs:
        row.append(_kv(kv[0], kv[1]))
        if len(row) == 2:
            rows.append([row[0][0], row[0][1], row[1][0], row[1][1]])
            row = []
    if row:
        rows.append([row[0][0], row[0][1], "", ""])
    tbl = Table(rows, colWidths=[35 * mm, 60 * mm, 35 * mm, 56 * mm])
    tbl.setStyle(TableStyle([
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("BOX", (0, 0), (-1, -1), 0.3, rl_colors.HexColor("#CBD5E1")),
        ("INNERGRID", (0, 0), (-1, -1), 0.2, rl_colors.HexColor("#E2E8F0")),
        ("LEFTPADDING", (0, 0), (-1, -1), 6),
        ("RIGHTPADDING", (0, 0), (-1, -1), 6),
        ("TOPPADDING", (0, 0), (-1, -1), 4),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
    ]))
    return tbl


def build_customer_pdf(c: dict) -> bytes:
    buf = BytesIO()
    doc = SimpleDocTemplate(buf, pagesize=A4, leftMargin=12 * mm, rightMargin=12 * mm, topMargin=10 * mm, bottomMargin=10 * mm)
    elems = []

    # Header
    hdr = Table([[
        [Paragraph(COMPANY, _h1), Paragraph("Contractor / Customer Profile", _sec)],
        [Paragraph(f"<b>ID:</b> {c.get('customer_code') or '—'}", _val),
         Paragraph(f"<b>Created:</b> {str(c.get('created_at') or '')[:10]}", _body)],
    ]], colWidths=[120 * mm, 66 * mm])
    hdr.setStyle(TableStyle([("VALIGN", (0, 0), (-1, -1), "TOP")]))
    elems.append(hdr)
    elems.append(Spacer(1, 8))

    # Section 1: Personal / Contact
    elems.append(_section("PERSONAL & CONTACT DETAILS"))
    elems.append(_grid([
        ("Contractor Name", c.get("name")),
        ("Father / Guardian", c.get("father_name")),
        ("Mobile No.", c.get("mobile")),
        ("WhatsApp No.", c.get("whatsapp")),
        ("Email", c.get("email")),
        ("Alt Mobile", c.get("alt_mobile")),
        ("Date of Birth", c.get("date_of_birth")),
        ("Gender", c.get("gender")),
    ]))
    elems.append(Spacer(1, 6))

    # Section 2: Address
    elems.append(_section("ADDRESS"))
    elems.append(_grid([
        ("Address", c.get("address")),
        ("City", c.get("city")),
        ("District", c.get("district")),
        ("State", c.get("state")),
        ("Pincode", c.get("pincode")),
        ("Country", c.get("country") or "India"),
    ]))
    elems.append(Spacer(1, 6))

    # Section 3: Identity / KYC
    elems.append(_section("KYC & IDENTITY"))
    elems.append(_grid([
        ("PAN No.", c.get("pan")),
        ("Aadhar No.", c.get("aadhar")),
        ("Voter ID", c.get("voter_id")),
        ("Driving Licence", c.get("driving_licence")),
        ("Passport No.", c.get("passport_no")),
        ("GSTIN", c.get("gst_no")),
    ]))
    elems.append(Spacer(1, 6))

    # Section 4: Business / Registration
    elems.append(_section("BUSINESS & REGISTRATION"))
    elems.append(_grid([
        ("Firm Name", c.get("firm_name")),
        ("Firm Type", c.get("firm_type")),
        ("Contractor Reg. No.", c.get("contractor_reg_no")),
        ("Registration Date", c.get("registration_date")),
        ("Registration Validity", c.get("registration_validity")),
        ("Registration Authority", c.get("registration_authority")),
        ("Class / Category", c.get("contractor_class")),
        ("PWD / Dept.", c.get("department")),
    ]))
    elems.append(Spacer(1, 6))

    # Section 5: Banking
    elems.append(_section("BANKING DETAILS"))
    elems.append(_grid([
        ("Bank Name", c.get("bank_name")),
        ("Branch", c.get("bank_branch")),
        ("Account No.", c.get("bank_account_no")),
        ("IFSC Code", c.get("bank_ifsc")),
        ("Account Holder", c.get("account_holder_name")),
        ("Account Type", c.get("bank_account_type")),
    ]))
    elems.append(Spacer(1, 6))

    # Section 6: DSC / Digital Signature (Signing & Encryption)
    elems.append(_section("DIGITAL SIGNATURE CERTIFICATES (DSC)"))
    dsc_issued = format_dsc_datetime(c.get("dsc_issued_date") or c.get("dsc_issue_date"))
    dsc_exp = format_dsc_datetime(c.get("dsc_expired_date") or c.get("dsc_expiry"))
    enc_issued = format_dsc_datetime(c.get("encryption_issued_date"))
    enc_exp = format_dsc_datetime(c.get("encryption_expired_date"))

    dsc_rows = [
        [
            Paragraph("<b>DSC Serial No.</b>", _lbl),
            Paragraph(str(c.get("dsc_serial_no") or "—"), _val),
            Paragraph("<b>Encryption Serial No.</b>", _lbl),
            Paragraph(str(c.get("encryption_serial_no") or "—"), _val),
        ],
        [
            Paragraph("<b>DSC Issued Date</b>", _lbl),
            Paragraph(dsc_issued, _val),
            Paragraph("<b>Encryption Issued Date</b>", _lbl),
            Paragraph(enc_issued, _val),
        ],
        [
            Paragraph("<b>DSC Expired Date</b>", _lbl),
            Paragraph(dsc_exp, _val),
            Paragraph("<b>Encryption Expired Date</b>", _lbl),
            Paragraph(enc_exp, _val),
        ],
    ]
    if c.get("dsc_class") or c.get("dsc_token") or c.get("dsc_ca"):
        dsc_rows.append([
            Paragraph("<b>DSC Class / Token</b>", _lbl),
            Paragraph(f"{c.get('dsc_class') or ''} {c.get('dsc_token') or ''}".strip() or "—", _val),
            Paragraph("<b>Cert Authority</b>", _lbl),
            Paragraph(str(c.get("dsc_ca") or "—"), _val),
        ])

    dsc_tbl = Table(dsc_rows, colWidths=[38 * mm, 55 * mm, 40 * mm, 53 * mm])
    dsc_tbl.setStyle(TableStyle([
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("BOX", (0, 0), (-1, -1), 0.3, rl_colors.HexColor("#CBD5E1")),
        ("INNERGRID", (0, 0), (-1, -1), 0.2, rl_colors.HexColor("#E2E8F0")),
        ("LEFTPADDING", (0, 0), (-1, -1), 6),
        ("RIGHTPADDING", (0, 0), (-1, -1), 6),
        ("TOPPADDING", (0, 0), (-1, -1), 5),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 5),
        ("BACKGROUND", (0, 0), (0, -1), rl_colors.HexColor("#F8FAFC")),
        ("BACKGROUND", (2, 0), (2, -1), rl_colors.HexColor("#F8FAFC")),
    ]))
    elems.append(dsc_tbl)
    elems.append(Spacer(1, 6))

    # Section 7: Notes / Remarks
    if c.get("remarks") or c.get("notes"):
        elems.append(_section("NOTES / REMARKS"))
        note = c.get("remarks") or c.get("notes") or "—"
        elems.append(Table([[Paragraph(note, _body)]], colWidths=[186 * mm],
                          style=TableStyle([
                              ("BOX", (0, 0), (-1, -1), 0.3, rl_colors.HexColor("#CBD5E1")),
                              ("LEFTPADDING", (0, 0), (-1, -1), 8), ("RIGHTPADDING", (0, 0), (-1, -1), 8),
                              ("TOPPADDING", (0, 0), (-1, -1), 6), ("BOTTOMPADDING", (0, 0), (-1, -1), 6),
                          ])))

    elems.append(Spacer(1, 10))
    elems.append(Paragraph(f"<b>Generated by:</b> {COMPANY} • This is a system-generated profile document.", _lbl))

    doc.build(elems)
    return buf.getvalue()


class NumberedCanvas(canvas.Canvas):
    """Two-pass canvas for dynamic 'Page X of Y' footer on every page."""
    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self._saved_page_states = []

    def showPage(self):
        self._saved_page_states.append(dict(self.__dict__))
        self._startPage()

    def save(self):
        num_pages = len(self._saved_page_states)
        for state in self._saved_page_states:
            self.__dict__.update(state)
            self.draw_page_decorations(num_pages)
            super().showPage()
        super().save()

    def draw_page_decorations(self, page_count):
        self.saveState()
        self.setFont("Helvetica", 7.5)
        self.setFillColor(rl_colors.HexColor("#64748B"))
        # Footer
        footer_text = f"Page {self._pageNumber} of {page_count}"
        self.drawRightString(287 * mm, 7 * mm, footer_text)
        gen_time = datetime.now().strftime("%d-%m-%Y %I:%M:%S %p")
        self.drawString(10 * mm, 7 * mm, f"{COMPANY} • Confidential & Proprietary Contractors Directory • Generated: {gen_time}")
        self.setStrokeColor(rl_colors.HexColor("#CBD5E1"))
        self.setLineWidth(0.5)
        self.line(10 * mm, 11 * mm, 287 * mm, 11 * mm)
        self.restoreState()


def mask_pan(pan: str) -> str:
    """Mask PAN number according to privacy guidelines: e.g. ABCDE****F."""
    if not pan:
        return "—"
    p = str(pan).strip().upper()
    if len(p) == 10:
        return f"{p[:5]}****{p[-1]}"
    if len(p) > 4:
        return f"{p[:2]}****{p[-2:]}"
    return "****"


def generate_contractors_directory_pdf(contractors: list) -> bytes:
    """Generate a high-grade landscape PDF directory for selected contractors with repeating headers and page numbers."""
    buf = BytesIO()
    doc = SimpleDocTemplate(
        buf,
        pagesize=landscape(A4),
        leftMargin=10 * mm,
        rightMargin=10 * mm,
        topMargin=12 * mm,
        bottomMargin=14 * mm,
    )

    styles = getSampleStyleSheet()
    title_style = ParagraphStyle(
        "DirTitle",
        parent=styles["Normal"],
        fontName="Helvetica-Bold",
        fontSize=15,
        leading=18,
        textColor=rl_colors.HexColor("#0F172A"),
    )
    comp_style = ParagraphStyle(
        "DirComp",
        parent=styles["Normal"],
        fontName="Helvetica-Bold",
        fontSize=10,
        leading=13,
        textColor=rl_colors.HexColor("#1E40AF"),
    )
    meta_style = ParagraphStyle(
        "DirMeta",
        parent=styles["Normal"],
        fontName="Helvetica",
        fontSize=8,
        leading=10,
        textColor=rl_colors.HexColor("#64748B"),
    )

    th_style = ParagraphStyle(
        "DirTH",
        parent=styles["Normal"],
        fontName="Helvetica-Bold",
        fontSize=7.5,
        leading=9.5,
        textColor=rl_colors.white,
        alignment=1, # Center
    )
    td_style = ParagraphStyle(
        "DirTD",
        parent=styles["Normal"],
        fontName="Helvetica",
        fontSize=7.5,
        leading=9.5,
        textColor=rl_colors.HexColor("#1E293B"),
    )
    td_code = ParagraphStyle(
        "DirTDCode",
        parent=styles["Normal"],
        fontName="Helvetica-Bold",
        fontSize=7.5,
        leading=9.5,
        textColor=rl_colors.HexColor("#1E40AF"),
    )
    td_center = ParagraphStyle(
        "DirTDCenter",
        parent=styles["Normal"],
        fontName="Helvetica",
        fontSize=7.5,
        leading=9.5,
        textColor=rl_colors.HexColor("#334155"),
        alignment=1,
    )

    elems = []

    # Organization Header / Branding banner
    header_content = [
        [
            Paragraph(f"<b>{COMPANY}</b>", comp_style),
            Paragraph(f"<b>Total Contractors:</b> {len(contractors)}", ParagraphStyle("RightM", parent=meta_style, alignment=2)),
        ],
        [
            Paragraph("CONTRACTORS DIRECTORY & MASTER ENLISTMENT", title_style),
            Paragraph(f"Export Date: {datetime.now().strftime('%d-%m-%Y %I:%M %p')}", ParagraphStyle("RightM2", parent=meta_style, alignment=2)),
        ],
    ]
    header_tbl = Table(header_content, colWidths=[197 * mm, 80 * mm])
    header_tbl.setStyle(TableStyle([
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 1),
        ("TOPPADDING", (0, 0), (-1, -1), 1),
        ("LEFTPADDING", (0, 0), (-1, -1), 0),
        ("RIGHTPADDING", (0, 0), (-1, -1), 0),
    ]))
    elems.append(header_tbl)
    elems.append(Spacer(1, 4 * mm))

    # Table columns:
    # 1. Sl No (11mm)
    # 2. Contractor Code (24mm)
    # 3. Name (45mm)
    # 4. Mobile (25mm)
    # 5. PAN (Masked) (25mm)
    # 6. TDSC Branch (28mm)
    # 7. District (25mm)
    # 8. Concerned Department (35mm)
    # 9. Reg Class (22mm)
    # 10. DSC Expiry (37mm)
    # Total: 11+24+45+25+25+28+25+35+22+37 = 277 mm
    col_widths = [
        11 * mm, 24 * mm, 45 * mm, 25 * mm, 25 * mm,
        28 * mm, 25 * mm, 35 * mm, 22 * mm, 37 * mm
    ]

    headers = [
        Paragraph("<b>Sl.</b>", th_style),
        Paragraph("<b>Code</b>", th_style),
        Paragraph("<b>Contractor / Firm Name</b>", th_style),
        Paragraph("<b>Mobile</b>", th_style),
        Paragraph("<b>PAN No.</b>", th_style),
        Paragraph("<b>TDSC Branch</b>", th_style),
        Paragraph("<b>District</b>", th_style),
        Paragraph("<b>Concerned Dept.</b>", th_style),
        Paragraph("<b>Class</b>", th_style),
        Paragraph("<b>DSC Expiry Date</b>", th_style),
    ]

    table_data = [headers]

    for idx, c in enumerate(contractors, 1):
        c_code = str(c.get("customer_code") or c.get("id") or "—")
        c_name = str(c.get("name") or "—")
        c_mobile = str(c.get("mobile") or "—")
        c_pan = mask_pan(c.get("pan"))
        c_branch = str(c.get("branch_name") or c.get("branch") or "—")
        c_district = str(c.get("district") or "—")
        c_dept = str(c.get("departments") or "—")
        c_class = str(c.get("registration_class") or "—")
        c_dsc = format_dsc_datetime(c.get("dsc_expired_date") or c.get("dsc_expiry"))

        row = [
            Paragraph(str(idx), td_center),
            Paragraph(c_code, td_code),
            Paragraph(c_name, td_style),
            Paragraph(c_mobile, td_center),
            Paragraph(c_pan, td_center),
            Paragraph(c_branch, td_style),
            Paragraph(c_district, td_style),
            Paragraph(c_dept, td_style),
            Paragraph(c_class, td_center),
            Paragraph(c_dsc, td_style),
        ]
        table_data.append(row)

    main_table = Table(table_data, colWidths=col_widths, repeatRows=1)
    main_table.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, 0), rl_colors.HexColor("#1E40AF")),
        ("ALIGN", (0, 0), (-1, 0), "CENTER"),
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
        ("GRID", (0, 0), (-1, -1), 0.3, rl_colors.HexColor("#CBD5E1")),
        ("TOPPADDING", (0, 0), (-1, 0), 5),
        ("BOTTOMPADDING", (0, 0), (-1, 0), 5),
        ("TOPPADDING", (0, 1), (-1, -1), 4),
        ("BOTTOMPADDING", (0, 1), (-1, -1), 4),
        ("LEFTPADDING", (0, 0), (-1, -1), 3),
        ("RIGHTPADDING", (0, 0), (-1, -1), 3),
        ("ROWBACKGROUNDS", (0, 1), (-1, -1), [rl_colors.white, rl_colors.HexColor("#F8FAFC")]),
    ]))

    elems.append(main_table)

    doc.build(elems, canvasmaker=NumberedCanvas)
    return buf.getvalue()

