from django.core import signing
from django.contrib.auth.hashers import make_password
from django.test import TestCase, override_settings
from django.utils import timezone
from rest_framework.test import APIClient

from .models import Campaign, CreditLog, PanelLoginThrottle, User


@override_settings(SECRET_KEY="legacy-auth-test-secret-key-with-adequate-entropy", CAMPAIGN_DISPATCH_ENABLED=True)
class LegacyPanelAuthorizationTests(TestCase):
    def setUp(self):
        self.admin = self.make_user("admin", "admin")
        self.reseller = self.make_user("reseller", "reseller", self.admin, credit=100)
        self.child = self.make_user("child", "user", self.reseller, credit=40)
        self.other_reseller = self.make_user("other-reseller", "reseller", self.admin, credit=20)
        self.other_child = self.make_user("other-child", "user", self.other_reseller, credit=5)
        self.client = APIClient()

    def make_user(self, username, role="user", parent=None, credit=0):
        return User.objects.create(
            username=username,
            password="pbkdf2_sha256$not-used",
            role=role,
            parent=parent,
            credit=credit,
            status="Active",
        )

    def authenticate(self, user):
        user.refresh_from_db()
        token = signing.dumps({"user_id": user.pk, "token_version": user.token_version}, salt="provider-panel-session")
        self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {token}")
        return token

    def test_every_protected_legacy_route_rejects_anonymous_requests(self):
        requests = [
            ("post", "/api/create-user/", {"username": "newuser", "password": "longpassword"}),
            ("get", "/api/get-user/", {}),
            ("get", "/api/get-users/", {}),
            ("post", "/api/update-user/", {"user_id": self.child.pk}),
            ("post", "/api/delete-user/", {"user_id": self.child.pk}),
            ("post", "/api/toggle-status/", {"user_id": self.child.pk}),
            ("post", "/api/reset-password/", {"user_id": self.child.pk, "password": "longpassword"}),
            ("get", "/api/get-credit-logs/", {}),
            ("post", "/api/send-whatsapp/", {"total": 1, "results": [{"number": "123"}]}),
            ("get", "/api/get-campaigns/", {}),
        ]
        for method, path, data in requests:
            with self.subTest(path=path):
                response = getattr(self.client, method)(path, data, format="json")
                self.assertEqual(response.status_code, 401)

    def test_forged_user_id_cannot_change_actor_or_read_other_account(self):
        self.authenticate(self.child)
        response = self.client.get(f"/api/get-user/?user_id={self.other_child.pk}")
        self.assertEqual(response.status_code, 403)
        response = self.client.post("/api/update-user/", {"user_id": self.other_child.pk, "credit": 500}, format="json")
        self.assertEqual(response.status_code, 403)
        self.other_child.refresh_from_db()
        self.assertEqual(self.other_child.credit, 5)

    def test_user_self_service_cannot_change_privileged_fields_or_others_password(self):
        self.authenticate(self.child)
        for body in (
            {"user_id": self.child.pk, "role": "admin"},
            {"user_id": self.child.pk, "credit": 999},
            {"user_id": self.child.pk, "parent": self.admin.username},
        ):
            with self.subTest(body=body):
                response = self.client.post("/api/update-user/", body, format="json")
                self.assertEqual(response.status_code, 403)
        response = self.client.post("/api/reset-password/", {"user_id": self.other_child.pk, "password": "new-password-123"}, format="json")
        self.assertEqual(response.status_code, 403)

    def test_reseller_is_scoped_to_direct_children(self):
        self.authenticate(self.reseller)
        users = self.client.get(f"/api/get-users/?user_id={self.other_reseller.pk}")
        self.assertEqual([row["id"] for row in users.data], [self.child.pk])
        response = self.client.get(f"/api/get-user/?user_id={self.other_child.pk}")
        self.assertEqual(response.status_code, 403)
        response = self.client.post("/api/delete-user/", {"user_id": self.other_child.pk}, format="json")
        self.assertEqual(response.status_code, 403)
        response = self.client.post("/api/create-user/", {"username": "newchild", "password": "long-password", "role": "reseller", "parent": self.other_reseller.username}, format="json")
        self.assertEqual(response.status_code, 403)
        response = self.client.post("/api/create-user/", {"username": "newchild", "password": "long-password", "role": "user", "parent": self.other_reseller.username}, format="json")
        self.assertEqual(response.status_code, 200)
        created = User.objects.get(username="newchild")
        self.assertEqual(created.parent_id, self.reseller.pk)

    def test_reseller_credit_transfer_is_atomic_scoped_and_logged(self):
        self.authenticate(self.reseller)
        response = self.client.post("/api/update-user/", {"user_id": self.child.pk, "credit": 60}, format="json")
        self.assertEqual(response.data["status"], "success")
        self.reseller.refresh_from_db()
        self.child.refresh_from_db()
        self.assertEqual((self.reseller.credit, self.child.credit), (80, 60))
        self.assertEqual(CreditLog.objects.filter(user=self.child).count(), 1)
        response = self.client.post("/api/update-user/", {"user_id": self.other_child.pk, "credit": 50}, format="json")
        self.assertEqual(response.status_code, 403)
        response = self.client.post("/api/update-user/", {"user_id": self.child.pk, "credit": 1000}, format="json")
        self.assertEqual(response.data["status"], "failed")
        self.reseller.refresh_from_db()
        self.child.refresh_from_db()
        self.assertEqual((self.reseller.credit, self.child.credit), (80, 60))

    def test_admin_can_manage_children_but_cannot_delete_self(self):
        self.authenticate(self.admin)
        response = self.client.get("/api/get-users/")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(len(response.data), User.objects.count())
        response = self.client.post("/api/reset-password/", {"user_id": self.other_child.pk, "password": "admin-reset-123"}, format="json")
        self.assertEqual(response.data["status"], "success")
        response = self.client.post("/api/delete-user/", {"user_id": self.admin.pk}, format="json")
        self.assertEqual(response.status_code, 403)
        response = self.client.post("/api/toggle-status/", {"user_id": self.child.pk}, format="json")
        self.assertEqual(response.data["status"], "success")
        response = self.client.post("/api/delete-user/", {"user_id": self.reseller.pk}, format="json")
        self.assertEqual(response.status_code, 409)

    def test_admin_can_create_reseller_and_grant_credits_to_child(self):
        self.authenticate(self.admin)
        response = self.client.post("/api/create-user/", {
            "username": "created-reseller", "password": "long-password",
            "role": "reseller", "parent": self.admin.username,
        }, format="json")
        self.assertEqual(response.data["status"], "success")
        new_reseller = User.objects.get(username="created-reseller")
        self.assertEqual(new_reseller.parent_id, self.admin.pk)
        response = self.client.post("/api/update-user/", {"user_id": self.reseller.pk, "credit": 120}, format="json")
        self.assertEqual(response.data["status"], "success")
        self.reseller.refresh_from_db()
        self.assertEqual(self.reseller.credit, 120)


    def test_user_can_change_own_password_but_not_another_users(self):
        old_token = self.authenticate(self.child)
        response = self.client.post("/api/reset-password/", {"user_id": self.child.pk, "password": "self-reset-123"}, format="json")
        self.assertEqual(response.data["status"], "success")
        self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {old_token}")
        self.assertEqual(self.client.get("/api/get-users/").status_code, 401)
        login = self.client.post("/api/login/", {
            "username": self.child.username, "password": "self-reset-123",
        }, format="json")
        self.assertEqual(login.data["status"], "success")
        self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {login.data['panel_token']}")
        self.assertEqual(self.client.get("/api/get-users/").status_code, 200)
        before_change = login.data["panel_token"]
        response = self.client.post("/api/update-user/", {"user_id": self.child.pk, "password": "self-reset-456"}, format="json")
        self.assertEqual(response.data["status"], "success")
        self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {before_change}")
        self.assertEqual(self.client.get("/api/get-users/").status_code, 401)
        new_login = self.client.post("/api/login/", {
            "username": self.child.username, "password": "self-reset-456",
        }, format="json")
        self.assertEqual(new_login.data["status"], "success")
        self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {new_login.data['panel_token']}")
        self.assertEqual(self.client.get("/api/get-users/").status_code, 200)

    def test_password_reset_revokes_provider_panel_token_too(self):
        old_token = self.authenticate(self.child)
        response = self.client.post("/api/reset-password/", {"user_id": self.child.pk, "password": "revoked-token-pass"}, format="json")
        self.assertEqual(response.data["status"], "success")
        response = self.client.get("/api/provider/status/", HTTP_AUTHORIZATION=f"Bearer {old_token}")
        self.assertEqual(response.status_code, 401)

    def test_update_user_credit_validation_rejects_malformed_values_and_omission_is_noop(self):
        self.authenticate(self.reseller)
        for invalid in (None, True, False, -1, 1.5, "1.0", "abc", ""):
            with self.subTest(invalid=invalid):
                response = self.client.post("/api/update-user/", {
                    "user_id": self.child.pk, "credit": invalid,
                }, format="json")
                self.assertEqual(response.status_code, 400)
        self.child.refresh_from_db()
        self.reseller.refresh_from_db()
        self.assertEqual((self.child.credit, self.reseller.credit), (40, 100))
        self.assertFalse(CreditLog.objects.filter(user=self.child).exists())
        response = self.client.post("/api/update-user/", {
            "user_id": self.child.pk, "username": "child-renamed",
        }, format="json")
        self.assertEqual(response.data["status"], "success")
        self.child.refresh_from_db()
        self.assertEqual(self.child.credit, 40)

    def test_admin_password_change_revokes_target_sessions(self):
        old_token = signing.dumps({"user_id": self.child.pk, "token_version": self.child.token_version}, salt="provider-panel-session")
        self.authenticate(self.admin)
        response = self.client.post("/api/reset-password/", {
            "user_id": self.child.pk, "password": "admin-new-password",
        }, format="json")
        self.assertEqual(response.data["status"], "success")
        self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {old_token}")
        self.assertEqual(self.client.get("/api/get-users/").status_code, 401)

    def test_reseller_can_change_own_password(self):
        self.authenticate(self.reseller)
        response = self.client.post("/api/reset-password/", {"user_id": self.reseller.pk, "password": "reseller-secret"}, format="json")
        self.assertEqual(response.data["status"], "success")

    def test_campaign_creation_uses_authenticated_actor_and_debits_once(self):
        self.authenticate(self.child)
        response = self.client.post("/api/send-whatsapp/", {
            "user_id": self.child.pk,
            "results": [{"number": "919999999999", "status": "sent"}],
            "message": "hello",
            "total": 1,
            "status": "pending",
        }, format="json")
        self.assertEqual(response.data["status"], "saved")
        self.child.refresh_from_db()
        campaign = Campaign.objects.get()
        self.assertEqual(campaign.user_id, self.child.pk)
        self.assertEqual(campaign.status, "pending")
        self.assertTrue(campaign.credit_reserved)
        self.assertEqual(self.child.credit, 39)
        self.assertEqual(CreditLog.objects.filter(user=self.child).count(), 1)

    def test_panel_token_cannot_finalize_or_release_campaign_reservations(self):
        self.authenticate(self.child)
        reserve = self.client.post("/api/send-whatsapp/", {
            "user_id": self.child.pk, "results": [{"number": "919999999999", "status": "pending"}],
            "message": "hello", "total": 1, "status": "pending",
        }, format="json")
        campaign_id = reserve.data["campaign_id"]
        for final_status in ("completed", "failed"):
            denied = self.client.post("/api/send-whatsapp/", {
                "campaign_id": campaign_id, "user_id": self.child.pk,
                "total": 1, "results": [{"number": "919999999999", "status": "sent"}],
                "status": final_status,
            }, format="json")
            self.assertEqual(denied.status_code, 403)
        self.child.refresh_from_db()
        self.assertEqual(self.child.credit, 39)
        self.assertTrue(Campaign.objects.get(pk=campaign_id).credit_reserved)

    def test_campaign_forgery_and_invalid_input_have_no_database_or_credit_side_effect(self):
        self.authenticate(self.child)
        response = self.client.post("/api/send-whatsapp/", {
            "user_id": self.other_child.pk, "total": 1,
            "results": [{"number": "123", "status": "sent"}],
        }, format="json")
        self.assertEqual(response.status_code, 403)
        response = self.client.post("/api/send-whatsapp/", {
            "user_id": self.child.pk, "total": 2,
            "results": [{"number": "123", "status": "sent"}],
        }, format="json")
        self.assertEqual(response.status_code, 400)
        self.assertEqual(Campaign.objects.count(), 0)
        self.assertEqual(CreditLog.objects.count(), 0)
        self.child.refresh_from_db()
        self.assertEqual(self.child.credit, 40)

    def test_campaign_listing_and_logs_are_scoped_by_role(self):
        Campaign.objects.create(user=self.child, message="child", total=1)
        Campaign.objects.create(user=self.other_child, message="other", total=1)
        self.authenticate(self.reseller)
        response = self.client.get(f"/api/get-campaigns/?user_id={self.reseller.pk}")
        self.assertEqual(len(response.data), 1)
        response = self.client.get(f"/api/get-credit-logs/?user_id={self.other_child.pk}")
        self.assertEqual(response.status_code, 403)
        self.authenticate(self.admin)
        response = self.client.get("/api/get-campaigns/")
        self.assertEqual(len(response.data), 2)

    def test_invalid_and_inactive_tokens_are_rejected(self):
        self.client.credentials(HTTP_AUTHORIZATION="Bearer forged")
        self.assertEqual(self.client.get("/api/get-users/").status_code, 401)
        self.authenticate(self.child)
        self.child.status = "Deactive"
        self.child.save(update_fields=["status"])
        self.assertEqual(self.client.get("/api/get-users/").status_code, 401)

    def test_login_throttle_is_per_ip_and_new_login_token_is_usable(self):
        self.child.password = make_password("correct-login-password")
        self.child.save(update_fields=["password"])
        for _ in range(20):
            response = self.client.post("/api/login/", {
                "username": self.child.username, "password": "wrong-password",
            }, format="json", REMOTE_ADDR="203.0.113.10")
            self.assertEqual(response.status_code, 200)
        blocked = self.client.post("/api/login/", {
            "username": self.child.username, "password": "correct-login-password",
        }, format="json", REMOTE_ADDR="203.0.113.10")
        self.assertEqual(blocked.status_code, 429)

        # A different source IP is not locked out for the same account.
        allowed = self.client.post("/api/login/", {
            "username": self.child.username, "password": "correct-login-password",
        }, format="json", REMOTE_ADDR="203.0.113.11")
        self.assertEqual(allowed.status_code, 200)
        self.assertEqual(allowed.data["status"], "success")
        self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {allowed.data['panel_token']}")
        self.assertEqual(self.client.get("/api/get-users/").status_code, 200)

        self.assertEqual(PanelLoginThrottle.objects.count(), 2)
