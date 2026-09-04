import { useState, useCallback } from "react";
import { useNavigate } from "react-router-dom";

// ==========================================
// CONSTANTS
// ==========================================

const API_URL =
  "https://ownwhatsapp-backend-django.onrender.com";
  const TIMEOUT = 30000;
const MAX_RETRIES = 1;

// ==========================================
// VALIDATION
// ==========================================

function validate(username, password) {
  if (!username || username.length < 3) {
    return "Username must be at least 3 characters";
  }

  if (!password || password.length < 3) {
    return "Password must be at least 3 characters";
  }

  return null;
}

// ==========================================
// LOGIN REQUEST
// ==========================================

async function loginRequest(payload, attempt = 0) {
  const controller = new AbortController();

  const timer = setTimeout(() => {
    controller.abort();
  }, TIMEOUT);

  try {
    const response = await fetch(API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });

    const contentType = response.headers.get("content-type") || "";

    let data = null;

    if (contentType.includes("application/json")) {
      data = await response.json();
    } else {
      const text = await response.text();

      data = {
        status: "failed",
        message:
          text && text.length < 300
            ? text
            : `Server returned HTTP ${response.status}`,
      };
    }

    // HTTP error handling
    if (!response.ok) {
      return {
        status: "failed",
        message:
          data?.message ||
          data?.detail ||
          `Server error (${response.status})`,
      };
    }

    return data;
  } catch (err) {
    // Retry only network/timeout errors
    if (
      attempt < MAX_RETRIES &&
      (err.name === "AbortError" || err.name === "TypeError")
    ) {
      return loginRequest(payload, attempt + 1);
    }

    if (err.name === "AbortError") {
      throw new Error("REQUEST_TIMEOUT");
    }

    throw err;
  } finally {
    clearTimeout(timer);
  }
}

// ==========================================
// COMPONENT
// ==========================================

export default function Login() {
  const navigate = useNavigate();

  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [message, setMessage] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [touched, setTouched] = useState({
    username: false,
    password: false,
  });

  const handleBlur = useCallback((field) => {
    setTouched((prev) => ({
      ...prev,
      [field]: true,
    }));
  }, []);

  const handleSubmit = useCallback(
    async (e) => {
      e.preventDefault();

      const trimUser = username.trim().toLowerCase();
      const trimPass = password.trim();

      setTouched({
        username: true,
        password: true,
      });

      setMessage("");

      const validationError = validate(trimUser, trimPass);

      if (validationError) {
        setMessage(validationError);
        return;
      }

      setSubmitting(true);
      setMessage("Logging in...");

      try {
        const data = await loginRequest({
          username: trimUser,
          password: trimPass,
        });

        console.log("Login response:", data);

        if (
          data &&
          (data.status === "success" || data.success === true)
        ) {
          sessionStorage.clear();

          sessionStorage.setItem(
            "user_id",
            String(data.user_id || data.id || "")
          );

          sessionStorage.setItem(
            "role",
            data.role || "user"
          );

          sessionStorage.setItem(
            "user",
            JSON.stringify({
              id: data.user_id || data.id || "",
              username: trimUser,
              role: data.role || "user",
              credit: data.credit || 0,
            })
          );

          setMessage("Login successful ✅");

          setTimeout(() => {
            navigate("/dashboard");
          }, 300);
        } else {
          setMessage(
            data?.message ||
              data?.detail ||
              "Invalid username or password ❌"
          );
        }
      } catch (err) {
        console.error("Login error:", err);

        if (err.message === "REQUEST_TIMEOUT") {
          setMessage(
            "Server is taking too long to respond. Please try again ❌"
          );
        } else if (
          err.message &&
          err.message.toLowerCase().includes("failed to fetch")
        ) {
          setMessage(
            "Unable to connect to server. Please check API server ❌"
          );
        } else {
          setMessage(
            err.message || "Server error ❌"
          );
        }
      } finally {
        setSubmitting(false);
      }
    },
    [username, password, navigate]
  );

  const userErr =
    touched.username && username.trim().length < 3
      ? "Username must be at least 3 characters"
      : "";

  const passErr =
    touched.password && password.trim().length < 3
      ? "Password must be at least 3 characters"
      : "";

  const isSuccess = message.includes("successful") || message.includes("✅");

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-200 p-4">
      <div className="bg-white shadow-lg rounded-lg flex overflow-hidden w-full max-w-[1000px]">

        {/* LEFT IMAGE */}
        <div className="hidden md:flex w-1/2 items-center justify-center bg-white p-6">
          <img
            src="/login.png"
            alt="Login"
            className="w-full max-w-md object-contain"
          />
        </div>

        {/* RIGHT FORM */}
        <div className="w-full md:w-1/2 p-8 md:p-10">

          <h2 className="text-4xl font-medium mb-3">
            Login
          </h2>

          <p className="text-gray-500 mb-8 text-lg">
            Just sign in if you have an account.
          </p>

          <form onSubmit={handleSubmit} noValidate>

            {/* USERNAME */}
            <div className="mb-5">
              <input
                type="text"
                name="username"
                placeholder="Username"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                onBlur={() => handleBlur("username")}
                className={`input ${
                  userErr ? "border-red-400" : ""
                }`}
                autoComplete="username"
                autoCapitalize="none"
                disabled={submitting}
              />

              {userErr && (
                <p className="error mt-1">
                  {userErr}
                </p>
              )}
            </div>

            {/* PASSWORD */}
            <div className="mb-5">
              <input
                type="password"
                name="password"
                placeholder="Password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                onBlur={() => handleBlur("password")}
                className={`input ${
                  passErr ? "border-red-400" : ""
                }`}
                autoComplete="current-password"
                disabled={submitting}
              />

              {passErr && (
                <p className="error mt-1">
                  {passErr}
                </p>
              )}
            </div>

            {/* MESSAGE */}
            {message && (
              <p
                className={`text-base mb-4 ${
                  isSuccess
                    ? "text-green-600"
                    : message === "Logging in..."
                    ? "text-gray-500"
                    : "text-red-500"
                }`}
              >
                {message}
              </p>
            )}

            {/* BUTTON */}
            <button
              type="submit"
              disabled={submitting}
              className="btn w-full mt-4 text-xl py-3 flex items-center justify-center gap-2 disabled:opacity-70 disabled:cursor-not-allowed"
            >
              {submitting ? (
                <>
                  <span className="inline-block w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                  Logging in...
                </>
              ) : (
                "Login"
              )}
            </button>

          </form>
        </div>
      </div>

      <style>{`
        .input {
          width: 100%;
          padding: 12px;
          border: 1px solid #22c55e;
          outline: none;
          border-radius: 4px;
          font-size: 15px;
          transition: border-color 0.15s, box-shadow 0.15s;
        }

        .input:focus {
          border-color: #16a34a;
          box-shadow: 0 0 0 1px #16a34a;
        }

        .btn {
          background: #6cc04a;
          color: white;
          padding: 12px;
          border-radius: 4px;
          font-weight: 500;
          transition: background 0.15s;
          cursor: pointer;
        }

        .btn:hover:not(:disabled) {
          background: #5aad3d;
        }

        .error {
          color: red;
          font-size: 12px;
        }
      `}</style>
    </div>
  );
}