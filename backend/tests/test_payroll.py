import pytest
import uuid
from httpx import AsyncClient, ASGITransport
import server

@pytest.fixture(scope="session")
def anyio_backend():
    return "asyncio"

@pytest.mark.asyncio
async def test_payroll_and_salary_box_lifecycle():
    transport = ASGITransport(app=server.app)
    async with AsyncClient(transport=transport, base_url="http://testserver") as client:
        # 1. Login as Admin
        admin_email = server.os.environ.get("SEED_ADMIN_EMAIL", "admin@triveni.com")
        admin_pass = server.os.environ.get("SEED_ADMIN_PASSWORD", "admin123")
        login_res = await client.post("/api/auth/login", json={"email": admin_email, "password": admin_pass})
        assert login_res.status_code == 200, f"Admin login failed: {login_res.text}"
        admin_token = login_res.json()["session_token"]
        admin_headers = {"Authorization": f"Bearer {admin_token}"}

        # 2. Check employees exist or create a test employee
        emp_res = await client.get("/api/employees", headers=admin_headers)
        assert emp_res.status_code == 200
        employees = emp_res.json()
        
        if not employees:
            new_emp = {
                "name": "Ravi Kumar Test",
                "email": f"test_emp_{uuid.uuid4().hex[:6]}@triveni.com",
                "designation": "Executive Officer",
                "posting_branch": "Main Office",
                "pay": 25000.0,
                "da": 5000.0,
                "hra": 6000.0,
                "ma": 1500.0,
                "ta": 2000.0,
                "other1": 1000.0,
                "ded_epfo": 1800.0,
                "ded_esic": 300.0,
                "ded_advance": 2000.0,
                "ded_advance_installments": 2,
                "bank_name": "State Bank of India",
                "bank_account_no": "123456789012",
                "bank_ifsc": "SBIN0001234",
                "pan": "ABCDE1234F"
            }
            create_emp_res = await client.post("/api/employees", json=new_emp, headers=admin_headers)
            assert create_emp_res.status_code == 200, create_emp_res.text
            emp_target = create_emp_res.json()
        else:
            emp_target = employees[0]
            # Ensure employee has some salary structure
            update_struct = await client.patch(
                f"/api/payroll/employees/{emp_target['id']}/salary-structure",
                json={
                    "pay": 28000.0,
                    "da": 4500.0,
                    "hra": 5500.0,
                    "ma": 1200.0,
                    "ta": 1800.0,
                    "ded_epfo": 1800.0,
                    "ded_esic": 350.0,
                },
                headers=admin_headers
            )
            assert update_struct.status_code == 200
            emp_target = update_struct.json()

        test_month = "2026-09"

        # 3. Test Generate Payroll POST /api/payroll/generate
        gen_res = await client.post(
            "/api/payroll/generate",
            json={"month": test_month, "auto_sync_attendance": True},
            headers=admin_headers
        )
        assert gen_res.status_code == 200, gen_res.text
        gen_data = gen_res.json()
        assert gen_data["ok"] is True
        assert gen_data["generated_count"] >= 1

        # 4. Test GET /api/payroll/summary
        summary_res = await client.get(f"/api/payroll/summary?month={test_month}", headers=admin_headers)
        assert summary_res.status_code == 200, summary_res.text
        summary = summary_res.json()
        assert summary["month"] == test_month
        assert summary["slips_generated"] >= 1
        assert summary["total_net_payable"] > 0

        # 5. Test GET /api/payroll/slips
        slips_res = await client.get(f"/api/payroll/slips?month={test_month}", headers=admin_headers)
        assert slips_res.status_code == 200, slips_res.text
        slips = slips_res.json()
        assert len(slips) >= 1
        target_slip = next((s for s in slips if s["employee_id"] == emp_target["id"]), slips[0])
        slip_id = target_slip["id"]
        assert target_slip["total_days"] == 30
        assert target_slip["gross_amount"] > 0
        assert target_slip["net_payable"] > 0

        # 6. Test GET /api/payroll/slips/{id}
        single_slip_res = await client.get(f"/api/payroll/slips/{slip_id}", headers=admin_headers)
        assert single_slip_res.status_code == 200
        assert single_slip_res.json()["id"] == slip_id

        # 7. Test PATCH /api/payroll/slips/{id} - Mark Paid with UTR and Payment Mode
        utr_ref = f"UTR{uuid.uuid4().hex[:8].upper()}"
        pay_res = await client.patch(
            f"/api/payroll/slips/{slip_id}",
            json={
                "status": "paid",
                "payment_mode": "bank_transfer",
                "payment_ref": utr_ref,
                "bonus": 1500.0,
                "remarks": "September Salary Disbursed on time"
            },
            headers=admin_headers
        )
        assert pay_res.status_code == 200, pay_res.text
        paid_slip = pay_res.json()
        assert paid_slip["status"] == "paid"
        assert paid_slip["payment_mode"] == "bank_transfer"
        assert paid_slip["payment_ref"] == utr_ref
        assert paid_slip["bonus"] == 1500.0

        # 8. Test GET /api/payroll/slips/{id}/slip (Printable Payslip Data)
        payslip_res = await client.get(f"/api/payroll/slips/{slip_id}/slip", headers=admin_headers)
        assert payslip_res.status_code == 200, payslip_res.text
        payslip = payslip_res.json()
        assert "company" in payslip
        assert payslip["company"]["company_name"] == "Triveni DSC & e-Tender Service Pvt. Ltd."
        assert "earnings" in payslip
        assert len(payslip["earnings"]) >= 6
        assert "deductions" in payslip
        assert len(payslip["deductions"]) >= 4
        assert "net_payable_words" in payslip
        assert "Rupees Only" in payslip["net_payable_words"]
        assert payslip["payment"]["status"] == "paid"
        assert payslip["payment"]["reference"] == utr_ref

        # 9. Verify summary reflects paid status
        summary_res_2 = await client.get(f"/api/payroll/summary?month={test_month}", headers=admin_headers)
        assert summary_res_2.status_code == 200
        summary_2 = summary_res_2.json()
        assert summary_2["paid_count"] >= 1
        assert summary_2["total_paid"] > 0
