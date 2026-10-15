import re
from datetime import datetime, timezone
from io import BytesIO
from reportlab.lib.pagesizes import A4
from reportlab.lib import colors as rl_colors
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import mm
from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle
from reportlab.pdfgen import canvas

COMPANY = "TRIVENI DSC AND ETENDER SERVICE PVT. LTD"


class ExpenseVoucherCanvas(canvas.Canvas):
    """Canvas to add page numbers and company footer to Expense Approval Voucher."""
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
            self.draw_footer(num_pages)
            super().showPage()
        super().save()

    def draw_footer(self, page_count):
        self.saveState()
        self.setFont("Helvetica", 8)
        self.setFillColor(rl_colors.HexColor("#64748B"))
        text = f"Page {self._pageNumber} of {page_count}"
        self.drawRightString(200 * mm, 8 * mm, text)
        now_str = datetime.now().strftime("%d-%m-%Y %I:%M %p")
        self.drawString(10 * mm, 8 * mm, f"{COMPANY} • Expense Approval Management • Printed: {now_str}")
        self.setStrokeColor(rl_colors.HexColor("#CBD5E1"))
        self.setLineWidth(0.5)
        self.line(10 * mm, 12 * mm, 200 * mm, 12 * mm)
        self.restoreState()


def generate_expense_approval_pdf(v: dict) -> bytes:
    """Generate high quality PDF voucher for an Expense Approval record."""
    buf = BytesIO()
    doc = SimpleDocTemplate(
        buf,
        pagesize=A4,
        leftMargin=10 * mm,
        rightMargin=10 * mm,
        topMargin=12 * mm,
        bottomMargin=16 * mm,
    )

    styles = getSampleStyleSheet()

    title_style = ParagraphStyle(
        "VTitle",
        parent=styles["Normal"],
        fontName="Helvetica-Bold",
        fontSize=15,
        leading=18,
        textColor=rl_colors.HexColor("#0F172A"),
    )
    comp_style = ParagraphStyle(
        "VComp",
        parent=styles["Normal"],
        fontName="Helvetica-Bold",
        fontSize=11,
        leading=14,
        textColor=rl_colors.HexColor("#1E40AF"),
    )
    lbl_style = ParagraphStyle(
        "VLbl",
        parent=styles["Normal"],
        fontName="Helvetica-Bold",
        fontSize=8.5,
        leading=11,
        textColor=rl_colors.HexColor("#475569"),
    )
    val_style = ParagraphStyle(
        "VVal",
        parent=styles["Normal"],
        fontName="Helvetica",
        fontSize=8.5,
        leading=11,
        textColor=rl_colors.HexColor("#0F172A"),
    )
    val_bold = ParagraphStyle(
        "VValB",
        parent=styles["Normal"],
        fontName="Helvetica-Bold",
        fontSize=9,
        leading=12,
        textColor=rl_colors.HexColor("#0F172A"),
    )
    th_style = ParagraphStyle(
        "VTH",
        parent=styles["Normal"],
        fontName="Helvetica-Bold",
        fontSize=8,
        leading=10,
        textColor=rl_colors.white,
        alignment=1,
    )
    td_style = ParagraphStyle(
        "VTD",
        parent=styles["Normal"],
        fontName="Helvetica",
        fontSize=8,
        leading=10,
        textColor=rl_colors.HexColor("#1E293B"),
    )
    td_num = ParagraphStyle(
        "VTDNum",
        parent=styles["Normal"],
        fontName="Helvetica",
        fontSize=8,
        leading=10,
        alignment=2,
        textColor=rl_colors.HexColor("#1E293B"),
    )
    td_center = ParagraphStyle(
        "VTDCenter",
        parent=styles["Normal"],
        fontName="Helvetica",
        fontSize=8,
        leading=10,
        alignment=1,
        textColor=rl_colors.HexColor("#1E293B"),
    )

    elems = []

    # 1. Header Banner
    v_status = str(v.get("status") or "SUBMITTED").upper()
    status_bg = "#22C55E" if v_status == "APPROVED" else "#EF4444" if v_status == "REJECTED" else "#F59E0B" if v_status == "RETURNED" else "#3B82F6"

    header_table = Table([
        [
            Paragraph(f"<b>{COMPANY}</b>", comp_style),
            Paragraph(f"<b>STATUS: {v_status}</b>", ParagraphStyle("StatusTxt", parent=styles["Normal"], fontName="Helvetica-Bold", fontSize=9, textColor=rl_colors.HexColor(status_bg), alignment=2)),
        ],
        [
            Paragraph("EXPENSE APPROVAL VOUCHER", title_style),
            Paragraph(f"<b>Voucher No:</b> {v.get('voucher_no') or '—'}<br/><b>Date:</b> {v.get('voucher_date') or datetime.now().strftime('%d-%m-%Y')}", ParagraphStyle("VMeta", parent=styles["Normal"], fontName="Helvetica", fontSize=8.5, leading=11, alignment=2)),
        ],
    ], colWidths=[120 * mm, 70 * mm])
    header_table.setStyle(TableStyle([
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 2),
        ("TOPPADDING", (0, 0), (-1, -1), 2),
        ("LEFTPADDING", (0, 0), (-1, -1), 0),
        ("RIGHTPADDING", (0, 0), (-1, -1), 0),
    ]))
    elems.append(header_table)
    elems.append(Spacer(1, 4 * mm))

    # 2. Section: Customer & Linked Sale Voucher Metadata (Two Cards side by side)
    c_name = v.get("customer_name") or "—"
    c_code = v.get("customer_code") or v.get("customer_id") or "—"
    c_mobile = v.get("customer_mobile") or "—"
    c_pan = v.get("customer_pan") or "—"

    sale_no = v.get("sale_voucher_no") or "—"
    sale_type = str(v.get("sale_voucher_type") or "Invoice").upper()
    sale_amt = f"₹ {float(v.get('sale_voucher_amount') or 0):,.2f}"
    rec_amt = f"₹ {float(v.get('sale_received_amount') or 0):,.2f}"
    unpaid_amt = f"₹ {float(v.get('sale_unpaid_amount') or 0):,.2f}"

    meta_grid = [
        [
            Paragraph("<b>CONTRACTOR / CLIENT DETAILS</b>", ParagraphStyle("Hdr1", parent=lbl_style, textColor=rl_colors.HexColor("#1E40AF"))),
            Paragraph("<b>LINKED SALE VOUCHER / SETTLEMENT</b>", ParagraphStyle("Hdr2", parent=lbl_style, textColor=rl_colors.HexColor("#1E40AF"))),
        ],
        [
            Table([
                [Paragraph("Name:", lbl_style), Paragraph(c_name, val_bold)],
                [Paragraph("Code:", lbl_style), Paragraph(c_code, val_style)],
                [Paragraph("Mobile:", lbl_style), Paragraph(c_mobile, val_style)],
                [Paragraph("PAN:", lbl_style), Paragraph(c_pan, val_style)],
            ], colWidths=[20 * mm, 72 * mm]),
            Table([
                [Paragraph("Voucher Ref:", lbl_style), Paragraph(f"{sale_no} ({sale_type})", val_bold)],
                [Paragraph("Invoice Total:", lbl_style), Paragraph(sale_amt, val_style)],
                [Paragraph("Amount Received:", lbl_style), Paragraph(f"<b>{rec_amt}</b>", ParagraphStyle("Rec", parent=val_style, textColor=rl_colors.HexColor("#15803D")))],
                [Paragraph("Unpaid Balance:", lbl_style), Paragraph(unpaid_amt, val_style)],
            ], colWidths=[32 * mm, 62 * mm]),
        ],
    ]
    meta_table = Table(meta_grid, colWidths=[94 * mm, 96 * mm])
    meta_table.setStyle(TableStyle([
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("BACKGROUND", (0, 0), (0, 0), rl_colors.HexColor("#EFF6FF")),
        ("BACKGROUND", (1, 0), (1, 0), rl_colors.HexColor("#F0FDF4")),
        ("BOX", (0, 0), (0, -1), 0.5, rl_colors.HexColor("#BFDBFE")),
        ("BOX", (1, 0), (1, -1), 0.5, rl_colors.HexColor("#BBF7D0")),
        ("TOPPADDING", (0, 0), (-1, -1), 4),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
        ("LEFTPADDING", (0, 0), (-1, -1), 4),
        ("RIGHTPADDING", (0, 0), (-1, -1), 4),
    ]))
    elems.append(meta_table)
    elems.append(Spacer(1, 5 * mm))

    # 3. Itemized Expenses Table
    elems.append(Paragraph("<b>ITEMIZED EXPENSE BREAKDOWN</b>", ParagraphStyle("H3", parent=lbl_style, fontSize=9, textColor=rl_colors.HexColor("#0F172A"))))
    elems.append(Spacer(1, 1.5 * mm))

    exp_headers = [
        Paragraph("<b>#</b>", th_style),
        Paragraph("<b>Expense Head / Category</b>", th_style),
        Paragraph("<b>Particulars / Description</b>", th_style),
        Paragraph("<b>Qty</b>", th_style),
        Paragraph("<b>Rate (₹)</b>", th_style),
        Paragraph("<b>Amount (₹)</b>", th_style),
    ]

    exp_rows = [exp_headers]
    items = v.get("expenses") or []
    tot_expense = 0.0

    for idx, item in enumerate(items, 1):
        head = item.get("head") or "Expense"
        desc = item.get("description") or "—"
        qty = float(item.get("qty") or 1)
        rate = float(item.get("rate") or 0)
        amt = float(item.get("amount") or (qty * rate))
        tot_expense += amt

        exp_rows.append([
            Paragraph(str(idx), td_center),
            Paragraph(f"<b>{head}</b>", td_style),
            Paragraph(desc, td_style),
            Paragraph(f"{qty:g}", td_center),
            Paragraph(f"{rate:,.2f}", td_num),
            Paragraph(f"<b>{amt:,.2f}</b>", td_num),
        ])

    # Totals Row
    exp_rows.append([
        Paragraph("", td_style),
        Paragraph("<b>TOTAL CLAIMED EXPENSES</b>", ParagraphStyle("TotL", parent=td_style, fontName="Helvetica-Bold")),
        Paragraph("", td_style),
        Paragraph("", td_style),
        Paragraph("", td_style),
        Paragraph(f"<b>₹ {tot_expense:,.2f}</b>", ParagraphStyle("TotV", parent=td_num, fontName="Helvetica-Bold", textColor=rl_colors.HexColor("#1E40AF"))),
    ])

    exp_table = Table(exp_rows, colWidths=[8 * mm, 45 * mm, 65 * mm, 16 * mm, 26 * mm, 30 * mm], repeatRows=1)
    exp_table.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, 0), rl_colors.HexColor("#1E40AF")),
        ("ALIGN", (0, 0), (-1, 0), "CENTER"),
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
        ("GRID", (0, 0), (-1, -2), 0.3, rl_colors.HexColor("#CBD5E1")),
        ("BACKGROUND", (0, -1), (-1, -1), rl_colors.HexColor("#EFF6FF")),
        ("LINEABOVE", (0, -1), (-1, -1), 1, rl_colors.HexColor("#1E40AF")),
        ("TOPPADDING", (0, 0), (-1, -1), 4),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
        ("LEFTPADDING", (0, 0), (-1, -1), 4),
        ("RIGHTPADDING", (0, 0), (-1, -1), 4),
        ("ROWBACKGROUNDS", (0, 1), (-1, -2), [rl_colors.white, rl_colors.HexColor("#F8FAFC")]),
    ]))
    elems.append(exp_table)
    elems.append(Spacer(1, 4 * mm))

    # 4. Critical Pass-On Validation Audit Box
    rec_amount_float = float(v.get("sale_received_amount") or 0)
    surplus_float = rec_amount_float - tot_expense
    is_valid = tot_expense <= rec_amount_float

    audit_box_data = [
        [
            Paragraph("<b>FINANCIAL PASS-ON RULE VERIFICATION:</b>", ParagraphStyle("AB1", parent=lbl_style, fontSize=8)),
            Paragraph(
                f"Total Expense: <b>₹ {tot_expense:,.2f}</b> &nbsp;|&nbsp; "
                f"Received Amount: <b>₹ {rec_amount_float:,.2f}</b> &nbsp;|&nbsp; "
                f"Remaining Buffer: <b>₹ {surplus_float:,.2f}</b>",
                ParagraphStyle("AB2", parent=val_style, fontSize=8)
            ),
            Paragraph(
                "✓ PASS-ON RULE SATISFIED" if is_valid else "✕ RULE VIOLATION",
                ParagraphStyle("AB3", parent=val_bold, fontSize=8, alignment=2, textColor=rl_colors.HexColor("#15803D" if is_valid else "#DC2626"))
            ),
        ]
    ]
    audit_table = Table(audit_box_data, colWidths=[55 * mm, 100 * mm, 35 * mm])
    audit_table.setStyle(TableStyle([
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
        ("BACKGROUND", (0, 0), (-1, -1), rl_colors.HexColor("#F0FDF4" if is_valid else "#FEF2F2")),
        ("BOX", (0, 0), (-1, -1), 0.5, rl_colors.HexColor("#BBF7D0" if is_valid else "#FECACA")),
        ("TOPPADDING", (0, 0), (-1, -1), 4),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
        ("LEFTPADDING", (0, 0), (-1, -1), 5),
        ("RIGHTPADDING", (0, 0), (-1, -1), 5),
    ]))
    elems.append(audit_table)
    elems.append(Spacer(1, 4 * mm))

    # 5. Workflow History & Remarks
    history = v.get("workflow_history") or []
    if history:
        elems.append(Paragraph("<b>APPROVAL WORKFLOW & AUDIT TRAIL</b>", ParagraphStyle("H4", parent=lbl_style, fontSize=8.5)))
        elems.append(Spacer(1, 1 * mm))
        hist_rows = [
            [
                Paragraph("<b>Action</b>", th_style),
                Paragraph("<b>Authorized Personnel</b>", th_style),
                Paragraph("<b>Role</b>", th_style),
                Paragraph("<b>Timestamp</b>", th_style),
                Paragraph("<b>Remarks / Notes</b>", th_style),
            ]
        ]
        for h in history:
            act = str(h.get("action") or "").upper()
            actor = h.get("actor") or {}
            act_name = actor.get("name") or "System"
            act_role = actor.get("role") or "—"
            ts = h.get("timestamp") or "—"
            rem = h.get("remarks") or h.get("reason") or "—"

            hist_rows.append([
                Paragraph(f"<b>{act}</b>", td_style),
                Paragraph(act_name, td_style),
                Paragraph(act_role, td_center),
                Paragraph(ts, td_style),
                Paragraph(rem, td_style),
            ])
        hist_table = Table(hist_rows, colWidths=[25 * mm, 45 * mm, 25 * mm, 40 * mm, 55 * mm])
        hist_table.setStyle(TableStyle([
            ("BACKGROUND", (0, 0), (-1, 0), rl_colors.HexColor("#475569")),
            ("ALIGN", (0, 0), (-1, 0), "CENTER"),
            ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
            ("GRID", (0, 0), (-1, -1), 0.3, rl_colors.HexColor("#CBD5E1")),
            ("TOPPADDING", (0, 0), (-1, -1), 3),
            ("BOTTOMPADDING", (0, 0), (-1, -1), 3),
            ("LEFTPADDING", (0, 0), (-1, -1), 3),
            ("RIGHTPADDING", (0, 0), (-1, -1), 3),
            ("ROWBACKGROUNDS", (0, 1), (-1, -1), [rl_colors.white, rl_colors.HexColor("#F8FAFC")]),
        ]))
        elems.append(hist_table)
        elems.append(Spacer(1, 6 * mm))

    # 6. Signature Blocks
    created_by = v.get("created_by") or {}
    prep_name = created_by.get("name") or "Accountant"
    created_at = v.get("created_at") or datetime.now().strftime("%d-%m-%Y")

    approved_event = next((h for h in reversed(history) if h.get("action") == "approved"), None)
    appr_name = approved_event.get("actor", {}).get("name") if approved_event else "Pending Approval"
    appr_time = approved_event.get("timestamp") if approved_event else "—"

    sig_data = [
        [
            Paragraph(f"<b>Prepared By:</b><br/>{prep_name}<br/><font color='#64748B'>{created_at}</font>", val_style),
            Paragraph(f"<b>Verified By:</b><br/>Accounts Dept.<br/><font color='#64748B'>TDSC-OMS</font>", val_style),
            Paragraph(f"<b>Approved By:</b><br/>{appr_name}<br/><font color='#64748B'>{appr_time}</font>", val_style),
        ]
    ]
    sig_table = Table(sig_data, colWidths=[63 * mm, 64 * mm, 63 * mm])
    sig_table.setStyle(TableStyle([
        ("ALIGN", (0, 0), (-1, -1), "CENTER"),
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("LINEABOVE", (0, 0), (-1, -1), 0.5, rl_colors.HexColor("#94A3B8")),
        ("TOPPADDING", (0, 0), (-1, -1), 4),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
    ]))
    elems.append(sig_table)

    doc.build(elems, canvasmaker=ExpenseVoucherCanvas)
    return buf.getvalue()
