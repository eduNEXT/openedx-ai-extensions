#!/usr/bin/env python
"""
Tests for the `openedx-ai-extensions` API endpoints.
"""

import json
from unittest.mock import MagicMock, patch

import pytest
from django.contrib.auth import get_user_model
from django.test import Client
from django.urls import reverse
from opaque_keys.edx.keys import CourseKey

User = get_user_model()


@pytest.fixture
def user():
    """
    Create and return a test user.
    """
    return User.objects.create_user(
        username="testuser", email="testuser@example.com", password="password123"
    )


@pytest.fixture
def staff_user():
    """
    Create and return a test staff user.
    """
    return User.objects.create_user(
        username="staffuser",
        email="staffuser@example.com",
        password="password123",
        is_staff=True,
    )


@pytest.fixture
def course_key():
    """
    Create and return a test course key.
    """
    return CourseKey.from_string("course-v1:edX+DemoX+Demo_Course")


@pytest.fixture
def client():
    """
    Create and return a Django test client.
    """
    return Client()


@pytest.mark.django_db
def test_api_urls_are_registered():
    """
    Test that the API URLs are properly registered and accessible.
    """
    # Test that the v1 workflows URL can be reversed
    url = reverse("openedx_ai_extensions:api:v1:ai_workflows")
    assert url == "/openedx-ai-extensions/v1/workflows/"


# @pytest.mark.django_db
# def test_api_namespace_exists():
#     """
#     Test that the API namespace is properly configured.
#     """
#     # This will raise NoReverseMatch if the namespace doesn't exist
#     url = reverse("openedx_ai_extensions:api:v1:ai_pipelines")
#     assert url is not None


# @pytest.mark.django_db
# def test_unauthenticated_request_redirects(client):
#     """
#     Test that unauthenticated requests are redirected to login.
#     """
#     url = reverse("openedx_ai_extensions:api:v1:ai_pipelines")
#     response = client.get(url)
    
#     # Django login_required decorator redirects to login page
#     assert response.status_code == 302
#     assert "/accounts/login/" in response.url


# @pytest.mark.django_db
# def test_authenticated_get_request(client, user):
#     """
#     Test GET request with authenticated user.
#     """
#     client.force_login(user)
#     url = reverse("openedx_ai_extensions:api:v1:ai_pipelines")
    
#     with patch("openedx_ai_extensions.workflows.models.AIWorkflow.find_workflow_for_context") as mock_find:
#         # Mock the workflow creation and execution
#         mock_workflow = MagicMock()
#         mock_workflow.execute.return_value = {
#             "status": "success",
#             "result": "Test result",
#         }
#         mock_find.return_value = (mock_workflow, True)
        
#         response = client.get(url)
        
#         assert response.status_code == 200
#         data = json.loads(response.content)
#         assert data["status"] == "success"
#         assert "timestamp" in data
#         assert "workflow_created" in data


# @pytest.mark.django_db
# def test_authenticated_post_request_with_valid_data(client, user, course_key):
#     """
#     Test POST request with valid workflow data.
#     """
#     client.force_login(user)
#     url = reverse("openedx_ai_extensions:api:v1:ai_pipelines")
    
#     payload = {
#         "action": "summarize",
#         "courseId": str(course_key),
#         "context": {
#             "unit_id": "unit-123",
#         },
#         "user_input": {
#             "query": "Summarize this content",
#         },
#         "requestId": "test-request-123",
#     }
    
#     with patch("openedx_ai_extensions.workflows.models.AIWorkflow.find_workflow_for_context") as mock_find:
#         mock_workflow = MagicMock()
#         mock_workflow.execute.return_value = {
#             "status": "success",
#             "result": "Summary of the content",
#         }
#         mock_find.return_value = (mock_workflow, False)
        
#         response = client.post(
#             url,
#             data=json.dumps(payload),
#             content_type="application/json",
#         )
        
#         assert response.status_code == 200
#         data = json.loads(response.content)
#         assert data["status"] == "success"
#         assert data["requestId"] == "test-request-123"
#         assert data["workflow_created"] is False
#         assert "timestamp" in data
        
#         # Verify the workflow was called correctly
#         mock_find.assert_called_once()
#         call_kwargs = mock_find.call_args[1]
#         assert call_kwargs["action"] == "summarize"
#         assert call_kwargs["course_id"] == str(course_key)
#         assert call_kwargs["user"] == user


# @pytest.mark.django_db
# def test_post_request_with_invalid_json(client, user):
#     """
#     Test POST request with invalid JSON body.
#     """
#     client.force_login(user)
#     url = reverse("openedx_ai_extensions:api:v1:ai_pipelines")
    
#     response = client.post(
#         url,
#         data="invalid json{",
#         content_type="application/json",
#     )
    
#     assert response.status_code == 400
#     data = json.loads(response.content)
#     assert data["status"] == "error"
#     assert "Invalid JSON" in data["error"]


# @pytest.mark.django_db
# def test_post_request_with_validation_error(client, user):
#     """
#     Test POST request that triggers a ValidationError.
#     """
#     client.force_login(user)
#     url = reverse("openedx_ai_extensions:api:v1:ai_pipelines")
    
#     payload = {
#         "action": "invalid_action",
#         "courseId": "invalid-course-id",
#     }
    
#     with patch("openedx_ai_extensions.workflows.models.AIWorkflow.find_workflow_for_context") as mock_find:
#         from django.core.exceptions import ValidationError
#         mock_find.side_effect = ValidationError("Invalid workflow configuration")
        
#         response = client.post(
#             url,
#             data=json.dumps(payload),
#             content_type="application/json",
#         )
        
#         assert response.status_code == 400
#         data = json.loads(response.content)
#         assert data["status"] == "validation_error"
#         assert "Invalid workflow configuration" in data["error"]


# @pytest.mark.django_db
# def test_post_request_with_workflow_error(client, user):
#     """
#     Test POST request where workflow execution fails.
#     """
#     client.force_login(user)
#     url = reverse("openedx_ai_extensions:api:v1:ai_pipelines")
    
#     payload = {
#         "action": "summarize",
#         "courseId": "course-v1:edX+Test+2024",
#     }
    
#     with patch("openedx_ai_extensions.workflows.models.AIWorkflow.find_workflow_for_context") as mock_find:
#         mock_workflow = MagicMock()
#         mock_workflow.execute.return_value = {
#             "status": "error",
#             "error": "LLM processing failed",
#         }
#         mock_find.return_value = (mock_workflow, True)
        
#         response = client.post(
#             url,
#             data=json.dumps(payload),
#             content_type="application/json",
#         )
        
#         assert response.status_code == 500
#         data = json.loads(response.content)
#         assert data["status"] == "error"


# @pytest.mark.django_db
# def test_post_request_with_bad_request_status(client, user):
#     """
#     Test POST request where workflow returns a bad_request status.
#     """
#     client.force_login(user)
#     url = reverse("openedx_ai_extensions:api:v1:ai_pipelines")
    
#     payload = {
#         "action": "summarize",
#     }
    
#     with patch("openedx_ai_extensions.workflows.models.AIWorkflow.find_workflow_for_context") as mock_find:
#         mock_workflow = MagicMock()
#         mock_workflow.execute.return_value = {
#             "status": "bad_request",
#             "error": "Missing required context",
#         }
#         mock_find.return_value = (mock_workflow, True)
        
#         response = client.post(
#             url,
#             data=json.dumps(payload),
#             content_type="application/json",
#         )
        
#         assert response.status_code == 400
#         data = json.loads(response.content)
#         assert data["status"] == "bad_request"


# @pytest.mark.django_db
# def test_post_request_with_exception(client, user):
#     """
#     Test POST request where an unexpected exception occurs.
#     """
#     client.force_login(user)
#     url = reverse("openedx_ai_extensions:api:v1:ai_pipelines")
    
#     payload = {
#         "action": "summarize",
#     }
    
#     with patch("openedx_ai_extensions.workflows.models.AIWorkflow.find_workflow_for_context") as mock_find:
#         mock_find.side_effect = Exception("Unexpected error occurred")
        
#         response = client.post(
#             url,
#             data=json.dumps(payload),
#             content_type="application/json",
#         )
        
#         assert response.status_code == 500
#         data = json.loads(response.content)
#         assert data["status"] == "error"
#         assert "Unexpected error occurred" in data["error"]


# @pytest.mark.django_db
# def test_post_request_without_request_id(client, user):
#     """
#     Test POST request without requestId in payload.
#     """
#     client.force_login(user)
#     url = reverse("openedx_ai_extensions:api:v1:ai_pipelines")
    
#     payload = {
#         "action": "quiz_generate",
#         "courseId": "course-v1:edX+Test+2024",
#     }
    
#     with patch("openedx_ai_extensions.workflows.models.AIWorkflow.find_workflow_for_context") as mock_find:
#         mock_workflow = MagicMock()
#         mock_workflow.execute.return_value = {
#             "status": "success",
#         }
#         mock_find.return_value = (mock_workflow, True)
        
#         response = client.post(
#             url,
#             data=json.dumps(payload),
#             content_type="application/json",
#         )
        
#         assert response.status_code == 200
#         data = json.loads(response.content)
#         # Should default to "no-request-id"
#         assert data["requestId"] == "no-request-id"


# @pytest.mark.django_db
# def test_empty_post_request(client, user):
#     """
#     Test POST request with empty body.
#     """
#     client.force_login(user)
#     url = reverse("openedx_ai_extensions:api:v1:ai_pipelines")
    
#     with patch("openedx_ai_extensions.workflows.models.AIWorkflow.find_workflow_for_context") as mock_find:
#         mock_workflow = MagicMock()
#         mock_workflow.execute.return_value = {
#             "status": "success",
#         }
#         mock_find.return_value = (mock_workflow, True)
        
#         response = client.post(url)
        
#         # Should handle empty body gracefully
#         assert response.status_code == 200
#         mock_find.assert_called_once()
#         call_kwargs = mock_find.call_args[1]
#         assert call_kwargs["action"] is None
#         assert call_kwargs["course_id"] is None
#         assert call_kwargs["context"] == {}


# @pytest.mark.django_db
# def test_staff_user_can_access_workflow(client, staff_user):
#     """
#     Test that staff users can access the workflow endpoint.
#     """
#     client.force_login(staff_user)
#     url = reverse("openedx_ai_extensions:api:v1:ai_pipelines")
    
#     with patch("openedx_ai_extensions.workflows.models.AIWorkflow.find_workflow_for_context") as mock_find:
#         mock_workflow = MagicMock()
#         mock_workflow.execute.return_value = {
#             "status": "success",
#         }
#         mock_find.return_value = (mock_workflow, True)
        
#         response = client.get(url)
        
#         assert response.status_code == 200
#         data = json.loads(response.content)
#         assert data["status"] == "success"
