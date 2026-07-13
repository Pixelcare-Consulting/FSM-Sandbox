import { Fragment, useState, useEffect } from "react";
import Link from "next/link";
import { useRouter } from "next/router";
import { Alert, Card, Form, Button, Image, Spinner, InputGroup, Container, Row, Col } from "react-bootstrap";
import { useSettings } from "../../hooks/useSettings";
import { FaEnvelope, FaLock, FaEye, FaEyeSlash } from 'react-icons/fa';
import Swal from 'sweetalert2';
import Cookies from 'js-cookie';
import {
  clearSharedLastActivityAt,
  recordSessionProbe,
  resetSharedActivityOnLogin,
  syncActivityWithLoginSession,
} from '../../lib/auth/sessionTabSync';
import { fetchAuthenticatedUser } from '../../lib/auth/sessionProbe';
import { getQueryClient } from '../../lib/queryClient';
import { clearWarmupDone, runAppWarmup } from '../../lib/session/appWarmup';

const signInDebug = process.env.NODE_ENV !== 'production';

function signInDebugLog(...args) {
  if (signInDebug) console.log(...args);
}

const LOGIN_EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const FAIL_STORAGE_KEY = 'loginFailTracking';
const FAIL_WINDOW_MS = 5 * 60 * 1000;
const DASHBOARD_HOME = '/dashboard/overview';

function validateLoginInput(email, password) {
  const trimmedEmail = (email || '').trim();
  const trimmedPassword = password || '';

  if (!trimmedEmail || !trimmedPassword) {
    return { valid: false, message: 'Email and password are required.' };
  }
  if (!LOGIN_EMAIL_REGEX.test(trimmedEmail)) {
    return { valid: false, message: 'Please enter a valid email address.' };
  }

  return { valid: true, normalizedEmail: trimmedEmail.toLowerCase() };
}

function readFailTracking() {
  if (typeof window === 'undefined') {
    return { count: 0, firstFailAt: null };
  }
  try {
    const raw = sessionStorage.getItem(FAIL_STORAGE_KEY);
    if (!raw) return { count: 0, firstFailAt: null };
    return JSON.parse(raw);
  } catch {
    return { count: 0, firstFailAt: null };
  }
}

function recordClientLoginFail() {
  const now = Date.now();
  let { count, firstFailAt } = readFailTracking();
  if (!firstFailAt || now - firstFailAt > FAIL_WINDOW_MS) {
    count = 0;
    firstFailAt = now;
  }
  count += 1;
  sessionStorage.setItem(FAIL_STORAGE_KEY, JSON.stringify({ count, firstFailAt }));
  return count >= 3 ? 15 : 5;
}

function clearClientLoginFailTracking() {
  if (typeof window !== 'undefined') {
    sessionStorage.removeItem(FAIL_STORAGE_KEY);
  }
}

function hasSessionCookies() {
  const uid = Cookies.get('uid');
  const sessionId = Cookies.get('sessionId');
  return Boolean(uid && sessionId);
}

function updateWarmupModal(modal, { percent, label }, sapConnectionFailed) {
  const titleClass = sapConnectionFailed ? 'text-warning' : 'text-primary';
  modal.querySelector('.swal2-title').innerHTML =
    `<span class="fw-bold ${titleClass}">Preparing your workspace</span>`;
  modal.querySelector('.swal2-html-container').innerHTML = `
    <div class="text-center mb-2">
      <div class="spinner-border ${sapConnectionFailed ? 'text-warning' : 'text-primary'} mb-2" role="status">
        <span class="visually-hidden">Loading...</span>
      </div>
      <div class="text-muted mb-2">${label}</div>
      <div class="progress" style="height: 6px;">
        <div class="progress-bar ${sapConnectionFailed ? 'bg-warning' : ''} progress-bar-striped progress-bar-animated" role="progressbar" style="width: ${percent}%"></div>
      </div>
    </div>
  `;
}

const loadingMessages = [
  { title: '<span class="fw-bold text-primary">Welcome Back!</span>', message: 'Verifying your credentials with our secure servers...', progress: 15 },
  { title: '<span class="fw-bold text-primary">Authenticating</span>', message: 'Establishing encrypted connection...', progress: 30 },
  { title: '<span class="fw-bold text-primary">Connecting to SAP Business One</span>', message: 'Initializing Service Layer connection...', progress: 45 },
  { title: '<span class="fw-bold text-primary">Setting Up Your Session</span>', message: 'Retrieving company data and permissions...', progress: 60 },
  { title: '<span class="fw-bold text-primary">Almost There</span>', message: 'Loading your dashboard preferences...', progress: 75 },
  { title: '<span class="fw-bold text-primary">Finalizing</span>', message: 'Preparing your workspace...', progress: 90 }
];

const SignIn = () => {
  const router = useRouter();
  const { settings } = useSettings();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [alertMessage, setAlertMessage] = useState(null);
  const [alertVariant, setAlertVariant] = useState('warning');
  const [cooldownUntil, setCooldownUntil] = useState(0);
  const [cooldownTick, setCooldownTick] = useState(0);

  const cooldownSecondsRemaining =
    cooldownUntil > Date.now()
      ? Math.ceil((cooldownUntil - Date.now()) / 1000)
      : 0;
  const isInCooldown = cooldownSecondsRemaining > 0;

  const startCooldown = (seconds) => {
    setCooldownUntil(Date.now() + seconds * 1000);
  };

  const showAuthError = (message, retryAfterSeconds) => {
    let text = message || 'Invalid email or password. Please try again.';
    if (text === 'Failed to fetch') {
      text = 'Unable to reach the server. Check your connection and try again.';
    } else if (/invalid login credentials/i.test(text)) {
      text = 'Invalid email or password. Please check your credentials and try again.';
    }
    const cooldownSec =
      typeof retryAfterSeconds === 'number' && retryAfterSeconds > 0
        ? retryAfterSeconds
        : recordClientLoginFail();
    startCooldown(cooldownSec);
    setAlertVariant('danger');
    setAlertMessage(text);
    Swal.fire({
      icon: 'error',
      title: 'Sign In Failed',
      text,
      confirmButtonText: 'Try Again',
      confirmButtonColor: '#0061f2',
    });
  };

  // Self-heal stale idle-timer data — users should never need DevTools/localStorage cleanup.
  useEffect(() => {
    syncActivityWithLoginSession(Cookies.get);
  }, []);

  useEffect(() => {
    if (!isInCooldown) return undefined;
    const interval = setInterval(() => {
      if (Date.now() >= cooldownUntil) {
        setCooldownUntil(0);
      }
      setCooldownTick(Date.now());
    }, 1000);
    return () => clearInterval(interval);
  }, [cooldownUntil, isInCooldown]);

  useEffect(() => {
    if (!router.isReady) return;

    const raw = router.query.toast ?? router.query.alertmessage;
    const message =
      typeof raw === "string" ? raw : Array.isArray(raw) ? raw[0] : null;

    setAlertMessage(message || null);
    setAlertVariant('warning');
  }, [router.isReady, router.query.toast, router.query.alertmessage]);

  useEffect(() => {
    if (!router.isReady) return undefined;

    let cancelled = false;

    const checkAuth = async () => {
      signInDebugLog('🔍 Checking authentication state...');

      if (!hasSessionCookies()) {
        signInDebugLog('⚠️ No session cookies (uid + sessionId), showing sign-in form');
        return;
      }

      const expiryRaw = Cookies.get('B1SESSION_EXPIRY');
      if (expiryRaw) {
        const expiryTime = new Date(expiryRaw).getTime();
        if (!Number.isNaN(expiryTime) && Date.now() >= expiryTime) {
          signInDebugLog('⚠️ B1SESSION_EXPIRY in the past, skipping redirect');
          return;
        }
      }

      // HttpOnly cookies (e.g. B1SESSION) must be validated server-side, not via document.cookie.
      const user = await fetchAuthenticatedUser();
      if (cancelled) return;

      if (user) {
        signInDebugLog('🔄 Valid session found via server probe, redirecting to dashboard');
        router.replace(DASHBOARD_HOME);
      } else {
        signInDebugLog('⚠️ Session probe failed or returned no user');
      }
    };

    checkAuth();
    return () => {
      cancelled = true;
    };
  }, [router.isReady, router.replace]);

  useEffect(() => {
    return () => {
      Swal.close();
      setIsLoading(false);
    };
  }, []);

  const handleSubmit = async (e) => {
    e.preventDefault();

    if (isInCooldown) {
      setAlertVariant('warning');
      setAlertMessage(`Please wait ${cooldownSecondsRemaining}s before trying again.`);
      return;
    }

    const validation = validateLoginInput(email, password);
    if (!validation.valid) {
      setAlertVariant('danger');
      setAlertMessage(validation.message);
      return;
    }

    const normalizedEmail = validation.normalizedEmail;

    try {
      setIsLoading(true);
      clearSharedLastActivityAt();

      // Prevent duplicate login only when session cookies exist
      if (hasSessionCookies()) {
        const user = await fetchAuthenticatedUser();
        if (user) {
          const existingEmail = (user?.email || user?.username || '').toLowerCase().trim();
          const enteredEmail = normalizedEmail;
          if (existingEmail && enteredEmail && existingEmail === enteredEmail) {
            setAlertVariant('info');
            setAlertMessage('Already logged in. Redirecting to your dashboard...');
            router.push(DASHBOARD_HOME);
            setIsLoading(false);
            return;
          }
        }
      }

      signInDebugLog('🔄 Starting authentication process...');

      Swal.fire({
        title: loadingMessages[0].title,
        html: `
          <div class="text-center mb-4">
            <div class="spinner-border text-primary mb-3" role="status">
              <span class="visually-hidden">Loading...</span>
            </div>
            <div class="text-muted mb-3">${loadingMessages[0].message}</div>
            <div class="progress" style="height: 6px;">
              <div class="progress-bar progress-bar-striped progress-bar-animated" role="progressbar" style="width: ${loadingMessages[0].progress}%"></div>
            </div>
          </div>
        `,
        allowOutsideClick: false,
        showConfirmButton: false,
        didOpen: async (modal) => {
          try {
            await new Promise(resolve => setTimeout(resolve, 800));

            const response = await fetch('/api/login', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ email: normalizedEmail, password }),
              credentials: 'include'
            });

            if (!response.ok) {
              const errorData = await response.json().catch(() => ({}));
              if (response.status === 429) {
                throw Object.assign(
                  new Error(errorData.message || 'Too many login attempts. Please try again later.'),
                  { retryAfterSeconds: errorData.retryAfterSeconds || 15 }
                );
              }
              const fallback =
                response.status === 401
                  ? 'Invalid email or password. Please check your credentials and try again.'
                  : 'Authentication failed. Please try again.';
              throw new Error(errorData.message || fallback);
            }

            const data = await response.json();
            signInDebugLog('📊 Server response:', data);
            const sapConnectionFailed = data.sapConnectionStatus === 'failed';

            for (let i = 1; i < loadingMessages.length; i++) {
              modal.querySelector('.swal2-title').innerHTML = loadingMessages[i].title;
              modal.querySelector('.swal2-html-container').innerHTML = `
                <div class="text-center mb-2">
                  <div class="spinner-border text-primary mb-2" role="status">
                    <span class="visually-hidden">Loading...</span>
                  </div>
                  <div class="text-muted mb-2">${loadingMessages[i].message}</div>
                  <div class="progress" style="height: 6px;">
                    <div class="progress-bar progress-bar-striped progress-bar-animated" role="progressbar" style="width: ${loadingMessages[i].progress}%"></div>
                  </div>
                </div>
              `;
              if (i === 2 && sapConnectionFailed) {
                modal.querySelector('.swal2-title').innerHTML = '<span class="fw-bold text-warning">⚠️ SAP Connection Issue</span>';
                modal.querySelector('.swal2-html-container').innerHTML = `
                  <div class="text-center mb-2">
                    <div class="spinner-border text-warning mb-2" role="status"></div>
                    <div class="text-muted mb-2">SAP Service Layer connection failed, continuing with limited access...</div>
                    <div class="progress" style="height: 6px;">
                      <div class="progress-bar bg-warning progress-bar-striped progress-bar-animated" role="progressbar" style="width: 60%"></div>
                    </div>
                  </div>
                `;
                await new Promise(resolve => setTimeout(resolve, 1500));
              } else {
                await new Promise(resolve => setTimeout(resolve, 600));
              }
            }

            if (sapConnectionFailed) {
              modal.querySelector('.swal2-title').innerHTML = '<span class="fw-bold text-warning">Logged In</span>';
              modal.querySelector('.swal2-html-container').innerHTML = `
                <div class="text-center">
                  <div class="mb-3"><div class="text-warning" style="font-size: 3rem;">⚠️</div></div>
                  <div class="text-muted mb-3">You're in! SAP Business One connection is limited—some features may be unavailable.</div>
                  <div class="progress mb-3" style="height: 6px;"><div class="progress-bar bg-warning" role="progressbar" style="width: 100%"></div></div>
                  <div class="countdown-text text-muted small">Verifying session...</div>
                </div>
              `;
            } else {
              modal.querySelector('.swal2-title').innerHTML = '<span class="fw-bold text-success">You\'re In!</span>';
              modal.querySelector('.swal2-html-container').innerHTML = `
                <div class="text-center">
                  <div class="checkmark-circle mb-2"><div class="checkmark draw"></div></div>
                  <div class="text-muted mb-2">SAS Field Service Portal is ready. Verifying session...</div>
                  <div class="progress mb-2" style="height: 6px;"><div class="progress-bar bg-success" role="progressbar" style="width: 100%"></div></div>
                </div>
              `;
            }

            await new Promise((resolve) => setTimeout(resolve, 500));

            let verifyRes;
            try {
              verifyRes = await fetch('/api/getUserInfo', {
                method: 'GET',
                credentials: 'include',
                cache: 'no-store',
                headers: { 'Content-Type': 'application/json' },
              });
            } finally {
              recordSessionProbe();
            }

            if (!verifyRes.ok) {
              if (verifyRes.status === 401) {
                throw new Error(
                  'Session could not be established — try clearing cookies or use one browser tab.'
                );
              }
              throw new Error('Session verification failed. Please try again.');
            }

            clearClientLoginFailTracking();
            resetSharedActivityOnLogin(Cookies.get);
            clearWarmupDone();

            const renderWarmupHtml = (seconds, warmupLabel = 'Caching dashboard data…', percent = 0) => {
              const barClass = sapConnectionFailed ? 'bg-warning' : 'bg-success';
              const successBlock = sapConnectionFailed
                ? `<div class="mb-3"><div class="text-warning" style="font-size: 3rem;">⚠️</div></div>
                   <div class="text-muted mb-3">You're in! SAP Business One connection is limited—some features may be unavailable.</div>`
                : `<div class="checkmark-circle mb-2"><div class="checkmark draw"></div></div>
                   <div class="text-muted mb-2">SAS Field Service Portal is ready. Preparing your workspace…</div>`;

              return `
                <div class="text-center">
                  ${successBlock}
                  <div class="warmup-status text-muted small mb-2">${warmupLabel}</div>
                  <div class="progress mb-2" style="height: 6px;">
                    <div class="progress-bar ${barClass} progress-bar-striped progress-bar-animated" role="progressbar" style="width: ${percent}%"></div>
                  </div>
                  <div class="countdown-text text-muted small">Redirecting in <span class="fw-bold text-primary" id="countdown">${seconds}</span> seconds...</div>
                </div>
              `;
            };

            const updateWarmupProgress = (update) => {
              const progressBar = modal.querySelector('.progress-bar');
              const messageEl = modal.querySelector('.warmup-status');
              if (progressBar && typeof update.percent === 'number') {
                progressBar.style.width = `${update.percent}%`;
              }
              if (messageEl && update.label) {
                messageEl.textContent = update.label;
              }
            };

            modal.querySelector('.swal2-title').innerHTML = sapConnectionFailed
              ? '<span class="fw-bold text-warning">Logged In</span>'
              : '<span class="fw-bold text-success">You\'re In!</span>';
            modal.querySelector('.swal2-html-container').innerHTML = renderWarmupHtml(3);

            const queryClient = getQueryClient();
            const warmupPromise = runAppWarmup({
              queryClient,
              onProgress: updateWarmupProgress,
            });

            const el = modal.querySelector('#countdown');
            for (let s = 3; s >= 1; s--) {
              if (el) el.textContent = s;
              await new Promise((r) => setTimeout(r, 1000));
            }

            await warmupPromise;
            window.location.href = DASHBOARD_HOME;
          } catch (error) {
            console.error('❌ Authentication error:', error);
            Swal.close();
            showAuthError(error.message, error.retryAfterSeconds);
            setIsLoading(false);
          }
        }
      });
    } catch (error) {
      console.error('❌ Authentication error:', error);
      showAuthError(error.message);
      setIsLoading(false);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <Fragment>
      <Container fluid className="p-0">
        <Row className="g-0 min-vh-100">
          {/* Left side with field service background */}
          <Col md={6} className="d-none d-md-block position-relative">
            <div className="bg-image h-100">
              <div className="overlay-gradient d-flex flex-column justify-content-center text-white p-5 h-100">
                <h1 className="display-4 fw-bold mb-4">Welcome Back!</h1>
                <p className="lead">
                  Access your SAS Field Service Management dashboard to manage your operations efficiently.
                </p>
              </div>
            </div>
          </Col>

          {/* Right side - Sign In Form */}
          <Col md={6} className="d-flex align-items-center justify-content-center bg-white p-4 p-md-5">
            <Card className="border-0 w-100 shadow-lg">
              <Card.Body className="p-4 p-md-5">
                <div className="text-center mb-5">
                  <Image
                    src="/images/SAS-LOGO.png"
                    alt="SAS Logo"
                    width={300}
                    height={100}
                    className="mb-4 img-fluid"
                  />
                  <h2 className="fw-bold text-dark mb-3">Sign In</h2>
                  <p className="text-muted">Enter your credentials to continue</p>
                </div>

                <Form onSubmit={handleSubmit}>
                  {alertMessage ? (
                    <Alert
                      variant={alertVariant}
                      dismissible
                      className="mb-4 border-0 shadow-sm"
                      onClose={() => setAlertMessage(null)}
                    >
                      {alertMessage}
                    </Alert>
                  ) : null}

                  <Form.Group className="mb-4" controlId="email">
                    <Form.Label className="fw-semibold text-dark">Email Address</Form.Label>
                    <InputGroup className="shadow-sm">
                      <InputGroup.Text className="bg-light border-0">
                        <FaEnvelope className="text-primary" />
                      </InputGroup.Text>
                      <Form.Control
                        type="email"
                        placeholder="name@email.com"
                        className="border-0 py-2.5"
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        disabled={isLoading || isInCooldown}
                        required
                      />
                    </InputGroup>
                  </Form.Group>

                  <Form.Group className="mb-4" controlId="password">
                    <InputGroup className="shadow-sm">
                      <InputGroup.Text className="bg-light border-0">
                        <FaLock className="text-muted" />
                      </InputGroup.Text>
                      <Form.Control
                        type={showPassword ? "text" : "password"}
                        placeholder="Enter your password"
                        className="border-0 py-2.5"
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        disabled={isLoading || isInCooldown}
                        required
                      />
                      <Button
                        variant="light"
                        onClick={() => setShowPassword(!showPassword)}
                        disabled={isLoading || isInCooldown}
                      >
                        {showPassword ? <FaEyeSlash /> : <FaEye />}
                      </Button>
                    </InputGroup>
                  </Form.Group>

                  <Form.Group className="mb-4">
                    <Form.Check
                      type="checkbox"
                      id="rememberMe"
                      label="Remember me"
                      className="text-muted"
                    />
                  </Form.Group>

                  <Button
                    variant="primary"
                    type="submit"
                    className="w-75 py-3 mb-4 rounded-pill shadow-sm mx-auto d-block"
                    disabled={isLoading || isInCooldown}
                  >
                    {isLoading ? (
                      <div className="d-flex align-items-center justify-content-center">
                        <Spinner
                          animation="border"
                          size="sm"
                          className="me-2"
                        />
                        <span>Signing in...</span>
                      </div>
                    ) : isInCooldown ? (
                      `Try again in ${cooldownSecondsRemaining}s`
                    ) : (
                      'Sign In'
                    )}
                  </Button>

                  <div className="text-center">
                    <p className="text-muted small">
                      By signing in, you agree to our{' '}
                      <Link href="#" className="text-primary text-decoration-none">
                        Terms of Service
                      </Link>{' '}
                      and{' '}
                      <Link href="#" className="text-primary text-decoration-none">
                        Privacy Policy
                      </Link>
                    </p>
                  </div>
                </Form>
              </Card.Body>
            </Card>
          </Col>
        </Row>
      </Container>

      <style jsx global>{`
        .bg-image {
          background-image: url('https://images.unsplash.com/photo-1600880292203-757bb62b4baf?q=80&w=1470&h=850');
          background-size: cover;
          background-position: center;
          position: relative;
        }

        .overlay-gradient {
          background: linear-gradient(
            135deg,
            rgba(50, 50, 50, 0.85) 0%,
            rgba(25, 25, 25, 0.85) 100%
          );
          backdrop-filter: blur(2px);
          position: absolute;
          top: 0;
          left: 0;
          right: 0;
          bottom: 0;
        }

        .card {
          border-radius: 1rem;
          transition: all 0.3s ease;
        }

        .form-control, .input-group-text {
          border: none;
          padding: 0.75rem 1rem;
        }

        .form-control:focus {
          box-shadow: none;
          border-color: #0061f2;
        }

        .input-group {
          border-radius: 0.75rem;
          overflow: hidden;
        }

        .btn-primary {
          background: linear-gradient(135deg, #0061f2 0%, #6900f2 100%);
          border: none;
          font-weight: 600;
          letter-spacing: 0.5px;
          transition: all 0.3s ease;
        }

        .btn-primary:hover {
          transform: translateY(-2px);
          box-shadow: 0 5px 15px rgba(0, 97, 242, 0.2);
        }

        .text-primary {
          color: #0061f2 !important;
        }

        .display-4 {
          font-size: 3.5rem;
          font-weight: 700;
          line-height: 1.2;
          text-shadow: 2px 2px 4px rgba(0, 0, 0, 0.2);
          color: #ffffff;
        }

        .lead {
          font-size: 1.25rem;
          font-weight: 300;
          line-height: 1.6;
          text-shadow: 1px 1px 2px rgba(0, 0, 0, 0.2);
          color: #ffffff;
        }

        @media (max-width: 768px) {
          .display-4 {
            font-size: 2.5rem;
          }
          .lead {
            font-size: 1.1rem;
          }
        }

        /* Animation classes */
        .animated {
          animation-duration: 0.5s;
          animation-fill-mode: both;
        }

        .fadeInUp {
          animation-name: fadeInUp;
        }

        @keyframes fadeInUp {
          from {
            opacity: 0;
            transform: translate3d(0, 20px, 0);
          }
          
          to {
            opacity: 1;
            transform: none;
          }
        }

        :root {
          --toaster-z-index: 9999;
        }

        .loading-toast {
          position: fixed !important;
          top: 50% !important;
          left: 50% !important;
          transform: translate(-50%, -50%) !important;
          background: white !important;
          z-index: 9999 !important;
        }

        .bg-gradient-overlay {
          background: linear-gradient(
            rgba(0, 97, 242, 0.8),
            rgba(105, 0, 242, 0.8)
          );
        }

        .img-fluid {
          max-width: 100%;
          height: auto;
        }

        /* Input Field Animations and Styling */
        .input-group {
          border-radius: 0.75rem;
          overflow: hidden;
          transition: all 0.3s ease;
        }

        .input-group:focus-within {
          transform: translateY(-2px);
          box-shadow: 0 5px 15px rgba(0, 97, 242, 0.1);
        }

        .form-control, .input-group-text {
          border: none;
          padding: 0.75rem 1rem;
          transition: all 0.3s ease;
        }

        .form-control:focus {
          box-shadow: none;
          background-color: #f8f9ff; /* Subtle background change on focus */
        }

        .input-group:focus-within .input-group-text {
          background-color: #f8f9ff; /* Matching background for the icon container */
          color: #0061f2;
        }

        .input-group:focus-within .text-primary {
          transform: scale(1.1); /* Slightly enlarge the icon */
        }

        /* Optional: Add a subtle scale animation when clicking the input */
        .form-control:active {
          transform: scale(0.995);
        }

        /* Input Label Animation */
        .form-label {
          transition: all 0.3s ease;
          position: relative;
        }

        .form-label::after {
          content: '';
          position: absolute;
          left: 0;
          bottom: -2px;
          width: 0;
          height: 2px;
          background: linear-gradient(135deg, #0061f2 0%, #6900f2 100%);
          transition: width 0.3s ease;
        }

        .input-group:focus-within + .form-label::after {
          width: 100%;
        }

        /* Enhanced placeholder animation */
        .form-control::placeholder {
          transition: all 0.3s ease;
        }

        .form-control:focus::placeholder {
          opacity: 0.7;
          transform: translateX(5px);
        }

        /* Add a subtle pulse animation to the icon when focused */
        @keyframes iconPulse {
          0% { transform: scale(1); }
          50% { transform: scale(1.1); }
          100% { transform: scale(1); }
        }

        .input-group:focus-within .input-group-text svg {
          animation: iconPulse 1s ease infinite;
          color: #0061f2;
        }

        /* Add a gentle glow effect */
        .input-group:focus-within {
          box-shadow: 0 0 0 3px rgba(0, 97, 242, 0.1);
        }

        /* Smooth transition for the entire form group */
        .form-group {
          transition: all 0.3s ease;
        }

        .form-group:focus-within {
          transform: translateY(-2px);
        }

        /* SweetAlert2 Custom Styles */
        .swal2-popup {
          border-radius: 1rem;
          padding: 1.5rem;
          max-width: 400px;
        }

        .swal2-icon {
          border-width: 3px !important;
          margin: 1.5rem auto !important;
        }

        .swal2-title {
          font-size: 1.5rem !important;
          margin: 0 0 0.5rem 0 !important;
          padding: 0 !important;
        }

        .swal2-html-container {
          margin: 0 !important;
          line-height: 1.5;
        }

        .swal2-actions {
          margin-top: 1.5rem !important;
        }

        .list-unstyled {
          padding-left: 0;
          list-style: none;
        }

        .alert-info {
          background-color: #f8f9fa;
          border-left: 4px solid #0061f2;
          padding: 1rem;
        }

        .shadow-lg {
          box-shadow: 0 1rem 3rem rgba(0,0,0,.175)!important;
        }

        /* Animation for error icon */
        @keyframes errorPulse {
          0% { transform: scale(1); }
          50% { transform: scale(1.05); }
          100% { transform: scale(1); }
        }

        .swal2-icon.swal2-error {
          animation: errorPulse 1s ease-in-out;
        }

        /* Loading Animation Styles */
        .progress {
          background-color: #e9ecef;
          border-radius: 0.5rem;
          overflow: hidden;
        }

        .progress-bar {
          background: linear-gradient(135deg, #0061f2 0%, #6900f2 100%);
          transition: width 0.5s ease-in-out;
        }

        /* Optimize animations */
        .swal2-popup {
          transform: translateZ(0);
          backface-visibility: hidden;
          perspective: 1000px;
        }

        .swal2-show {
          animation: swal2-show 0.3s ease-out;
        }

        .swal2-hide {
          animation: swal2-hide 0.15s ease-in forwards;
        }

        @keyframes swal2-show {
          0% {
            transform: scale(0.8);
            opacity: 0;
          }
          100% {
            transform: scale(1);
            opacity: 1;
          }
        }

        @keyframes swal2-hide {
          0% {
            transform: scale(1);
            opacity: 1;
          }
          100% {
            transform: scale(0.8);
            opacity: 0;
          }
        }

        /* Success Alert Styles */
        .swal2-success-ring {
          border-color: #0061f2 !important;
        }

        .swal2-icon.swal2-success {
          border-color: #0061f2 !important;
          color: #0061f2 !important;
        }

        .swal2-icon.swal2-success [class^='swal2-success-line'] {
          background-color: #0061f2 !important;
        }

        .swal2-timer-progress-bar {
          height: 0.25rem !important;
          opacity: 0.7;
          background: linear-gradient(to right, #0061f2, #6900f2) !important;
          transition: width 0.1s ease-in-out;
        }

        /* Pulse Animation for Button */
        .pulse-animation {
          animation: pulse 1s infinite;
        }

        @keyframes pulse {
          0% {
            transform: scale(1);
            box-shadow: 0 0 0 0 rgba(0, 97, 242, 0.7);
          }
          
          70% {
            transform: scale(1.05);
            box-shadow: 0 0 0 10px rgba(0, 97, 242, 0);
          }
          
          100% {
            transform: scale(1);
            box-shadow: 0 0 0 0 rgba(0, 97, 242, 0);
          }
        }

        /* Progress Bar Animation */
        .swal2-timer-progress-bar {
          height: 0.25rem !important;
          opacity: 0.7;
          background: linear-gradient(to right, #0061f2, #6900f2) !important;
          transition: width 0.1s ease-in-out;
        }

        /* Success Message Animations */
        @keyframes fadeInUp {
          from {
            opacity: 0;
            transform: translate3d(0, 20px, 0);
          }
          to {
            opacity: 1;
            transform: translate3d(0, 0, 0);
          }
        }

        .animated {
          animation-duration: 0.5s;
          animation-fill-mode: both;
        }

        .fadeInUp {
          animation-name: fadeInUp;
        }

        /* Enhanced Button Styles */
        .btn-primary {
          background: linear-gradient(135deg, #0061f2 0%, #6900f2 100%);
          border: none;
          font-weight: 600;
          letter-spacing: 0.5px;
          transition: all 0.3s ease;
        }

        .btn-primary:hover {
          transform: translateY(-2px);
          box-shadow: 0 5px 15px rgba(0, 97, 242, 0.2);
        }

        /* Container Styles */
        .countdown-text {
          font-size: 1.1rem;
          color: #6c757d;
        }

        .countdown-text strong {
          color: #0061f2;
          font-size: 1.2rem;
        }

        /* Error Alert Styles */
        .swal2-icon.swal2-error {
          border-color: #dc3545;
          color: #dc3545;
        }

        .swal2-icon.swal2-error [class^='swal2-x-mark-line'] {
          background-color: #dc3545;
        }

        .animated {
          animation-duration: 0.3s;
          animation-fill-mode: both;
        }

        @keyframes fadeInUp {
          from {
            opacity: 0;
            transform: translate3d(0, 20px, 0);
          }
          to {
            opacity: 1;
            transform: translate3d(0, 0, 0);
          }
        }

        .fadeInUp {
          animation-name: fadeInUp;
        }

        /* Ensure proper z-index stacking */
        .swal2-container {
          z-index: 9999;
        }

        /* Smooth transition for buttons */
        .btn {
          transition: all 0.2s ease-in-out;
        }

        .btn:active {
          transform: scale(0.95);
        }

        /* Spinner customization */
        .spinner-border {
          width: 2.5rem;
          height: 2.5rem;
          border-width: 0.25em;
        }

        /* Checkmark animation */
        .checkmark-circle {
          width: 40px;
          height: 40px;
          position: relative;
          display: inline-block;
          vertical-align: top;
          margin-left: auto;
          margin-right: auto;
        }

        .checkmark {
          width: 24px;
          height: 48px;
          position: absolute;
          transform: rotate(45deg);
          left: 14px;
          top: 0px;
        }

        .checkmark.draw:after {
          content: '';
          width: 6px;
          height: 0;
          background-color: #198754;
          position: absolute;
          right: 0;
          top: 0;
          animation: drawCheck 0.2s ease-in-out 0s forwards;
        }

        .checkmark.draw::before {
          content: '';
          width: 0;
          height: 6px;
          background-color: #198754;
          position: absolute;
          left: 0;
          bottom: 0;
          animation: drawCheck 0.2s ease-in-out 0.2s forwards;
        }

        @keyframes drawCheck {
          0% {
            width: 0;
            height: 0;
          }
          100% {
            width: 100%;
            height: 100%;
          }
        }

        /* Progress bar enhancement */
        .progress {
          background-color: #e9ecef;
          border-radius: 0.5rem;
          overflow: hidden;
        }

        .progress-bar {
          background: linear-gradient(135deg, #0061f2 0%, #6900f2 100%);
          transition: width 0.5s ease-in-out;
        }

        .progress-bar-animated {
          animation: progress-bar-stripes 1s linear infinite;
        }

        /* Modal enhancement */
        .swal2-popup {
          padding: 1.5rem;
        }

        .swal2-title {
          font-size: 1.5rem !important;
          margin-bottom: 1rem !important;
        }

        .text-muted {
          color: #6c757d !important;
          font-size: 1.1rem;
        }

        /* Countdown text styling */
        .countdown-text {
          font-size: 0.9rem;
          opacity: 0.8;
          margin-bottom: 1rem;
        }

        /* Enhanced button styling */
        .btn-primary {
          background: linear-gradient(135deg, #0061f2 0%, #6900f2 100%);
          border: none;
          font-weight: 600;
          letter-spacing: 0.5px;
          transition: all 0.3s ease;
          box-shadow: 0 2px 4px rgba(0, 97, 242, 0.1);
        }

        .btn-primary:hover {
          transform: translateY(-2px);
          box-shadow: 0 4px 8px rgba(0, 97, 242, 0.2);
        }

        .btn-primary:active {
          transform: translateY(0);
        }

        /* Animation for countdown */
        @keyframes pulse {
          0% { opacity: 1; }
          50% { opacity: 0.7; }
          100% { opacity: 1; }
        }

        .countdown-text .fw-bold {
          animation: pulse 1s infinite;
        }
      `}</style>
    </Fragment>
  );
};

export default SignIn;