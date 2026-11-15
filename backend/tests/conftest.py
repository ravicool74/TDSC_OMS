import os
import pytest

os.environ.setdefault("TEST_ADMIN_EMAIL", "admin@triveni.com")
os.environ.setdefault("TEST_ADMIN_PASSWORD", "admin123")
os.environ.setdefault("TEST_MANAGER_EMAIL", "manager@triveni.com")
os.environ.setdefault("TEST_MANAGER_PASSWORD", "manager123")
os.environ.setdefault("TEST_EMPLOYEE_EMAIL", "staff@triveni.com")
os.environ.setdefault("TEST_EMPLOYEE_PASSWORD", "staff123")
os.environ.setdefault("BASE_URL", "http://127.0.0.1:8000")
os.environ.setdefault("TEST_BASE_URL", "http://127.0.0.1:8000")
