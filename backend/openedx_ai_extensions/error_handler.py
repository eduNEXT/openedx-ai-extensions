"""
Centralized error handling for LiteLLM and OpenEdX AI Extensions.
Provides mapping between technical exceptions and safe, user-friendly messages for the frontend.
"""
import logging
import litellm
from django.core.exceptions import ValidationError
from rest_framework import status

logger = logging.getLogger(__name__)

# Error contract mapping technical identifiers to safe user-friendly messages and HTTP status codes
# Operators will see the internal code in logs, Users will only see the 'message'.
ERROR_MAP = {
    # --- Client / Request Errors (400s) ---
    "BAD_REQUEST": {
        "message": "The AI request could not be processed as sent.",
        "status": status.HTTP_400_BAD_REQUEST,
    },
    "UNSUPPORTED_PARAMS": {
        "message": "The AI service configuration is currently incompatible.",
        "status": status.HTTP_400_BAD_REQUEST,
    },
    "CONTEXT_WINDOW_EXCEEDED": {
        "message": "This conversation is too long. Please start a new chat to continue.",
        "status": status.HTTP_400_BAD_REQUEST,
    },
    "CONTENT_POLICY_VIOLATION": {
        "message": "The request was declined by the AI safety policy filter.",
        "status": status.HTTP_400_BAD_REQUEST,
    },
    "IMAGE_FETCH_ERROR": {
        "message": "There was a problem processing images for this request.",
        "status": status.HTTP_400_BAD_REQUEST,
    },
    "INVALID_INPUT": {
        "message": "The provided input is invalid.",
        "status": status.HTTP_400_BAD_REQUEST,
    },

    # --- Auth & Permission (401/403) ---
    "AUTHENTICATION_ERROR": {
        "message": "AI service authentication error. Please contact a course administrator.",
        "status": status.HTTP_401_UNAUTHORIZED,
    },
    "PERMISSION_DENIED": {
        "message": "Access to this AI model or configuration is restricted.",
        "status": status.HTTP_403_FORBIDDEN,
    },

    # --- Not Found (404) ---
    "NOT_FOUND": {
        "message": "The requested AI resource was not found.",
        "status": status.HTTP_404_NOT_FOUND,
    },

    # --- Timeout (408) ---
    "TIMEOUT": {
        "message": "The AI service is taking too long to respond. Please try again in 1-2 minutes.",
        "status": status.HTTP_408_REQUEST_TIMEOUT,
    },

    # --- Usage / Quota (429) ---
    "RATE_LIMIT": {
        "message": "Usage limit reached for the AI service. Please wait a moment before trying again.",
        "status": status.HTTP_429_TOO_MANY_REQUESTS,
    },
    "BUDGET_EXCEEDED": {
        "message": "Usage budget exceeded for this service. Please contact support.",
        "status": status.HTTP_429_TOO_MANY_REQUESTS,
    },

    # --- Provider / Server Errors (500s) ---
    # These often indicate operator error or provider outages. Safe messages only.
    "API_CONNECTION_ERROR": {
        "message": "Unable to connect to the AI service. Please check your connection.",
        "status": status.HTTP_503_SERVICE_UNAVAILABLE, # Map connection issues to 503 from user perspective
    },
    "SERVICE_UNAVAILABLE": {
        "message": "The AI provider is temporarily unavailable. Please try again later.",
        "status": status.HTTP_503_SERVICE_UNAVAILABLE,
    },
    "INTERNAL_SERVER_ERROR": {
        "message": "An internal error occurred while processing the AI request.",
        "status": status.HTTP_500_INTERNAL_SERVER_ERROR,
    },
    "API_RESPONSE_VALIDATION_ERROR": {
        "message": "The AI service returned an unreadable response. Please try again.",
        "status": status.HTTP_502_BAD_GATEWAY,
    },
    "UNEXPECTED_ERROR": {
        "message": "An unexpected error occurred. If this persists, please contact support.",
        "status": status.HTTP_500_INTERNAL_SERVER_ERROR,
    }
}

def get_error_info(exception):
    """
    Map LiteLLM/Workflow exceptions to ERROR_MAP entries.
    Returns (error_code, safe_message, http_status_code)
    """
    # Specific LiteLLM 400 errors
    if isinstance(exception, litellm.exceptions.ContextWindowExceededError):
        code = "CONTEXT_WINDOW_EXCEEDED"
    elif isinstance(exception, litellm.exceptions.ContentPolicyViolationError):
        code = "CONTENT_POLICY_VIOLATION"
    elif isinstance(exception, litellm.exceptions.UnsupportedParamsError):
        code = "UNSUPPORTED_PARAMS"
    elif isinstance(exception, litellm.exceptions.ImageFetchError):
        code = "IMAGE_FETCH_ERROR"
    elif isinstance(exception, (litellm.exceptions.BadRequestError, litellm.exceptions.InvalidRequestError)):
        code = "BAD_REQUEST"

    # 401 & 403
    elif isinstance(exception, litellm.exceptions.AuthenticationError):
        code = "AUTHENTICATION_ERROR"
    elif isinstance(exception, litellm.exceptions.PermissionDeniedError):
        code = "PERMISSION_DENIED"

    # 404
    elif isinstance(exception, litellm.exceptions.NotFoundError):
        code = "NOT_FOUND"

    # 408
    elif isinstance(exception, (litellm.exceptions.Timeout, litellm.exceptions.APITimeoutError)):
        code = "TIMEOUT"

    # 422
    elif isinstance(exception, litellm.exceptions.UnprocessableEntityError):
        code = "BAD_REQUEST" # Users see 422 as a Bad Request

    # 429
    elif isinstance(exception, litellm.exceptions.RateLimitError):
        code = "RATE_LIMIT"
    elif isinstance(exception, litellm.exceptions.BudgetExceededError):
        code = "BUDGET_EXCEEDED"

    # 500 & 503
    elif isinstance(exception, litellm.exceptions.ServiceUnavailableError):
        code = "SERVICE_UNAVAILABLE"
    elif isinstance(exception, litellm.exceptions.APIConnectionError):
        code = "API_CONNECTION_ERROR"
    elif isinstance(exception, (litellm.exceptions.InternalServerError, litellm.exceptions.APIError)):
        code = "INTERNAL_SERVER_ERROR"

    # Validation
    elif isinstance(exception, (litellm.exceptions.APIResponseValidationError, litellm.exceptions.JSONSchemaValidationError)):
        code = "API_RESPONSE_VALIDATION_ERROR"
    elif isinstance(exception, ValidationError):
        code = "INVALID_INPUT"

    # General LiteLLM
    elif isinstance(exception, litellm.exceptions.LiteLLMException):
        code = "INTERNAL_SERVER_ERROR"
    else:
        code = "UNEXPECTED_ERROR"

    error_details = ERROR_MAP.get(code, ERROR_MAP["UNEXPECTED_ERROR"])
    return code, error_details["message"], error_details.get("status", 500)
