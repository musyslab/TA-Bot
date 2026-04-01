import React, { useCallback, useEffect, useRef, useState } from "react";

// Uncomment for Marquette
import img from "../../images/MUCS-tag.png";

// Uncomment for Carroll
// import img from "../../Pioneer.png";

import { FaLock, FaMicrosoft, FaUser } from "react-icons/fa";
import axios from "axios";
import { Helmet } from "react-helmet";
import { Navigate } from "react-router-dom";
import { PublicClientApplication } from "@azure/msal-browser";

import "../../styling/Login.scss";

declare global {
  interface Window {
    google?: {
      accounts: {
        id: {
          initialize: (config: {
            client_id: string;
            callback: (response: { credential?: string }) => void;
          }) => void;
          renderButton: (
            parent: HTMLElement,
            options: {
              theme?: "outline" | "filled_blue" | "filled_black";
              size?: "large" | "medium" | "small";
              shape?: "rectangular" | "pill" | "circle" | "square";
              text?: "signin_with" | "signup_with" | "continue_with" | "signin";
              width?: number | string;
              logo_alignment?: "left" | "center";
            }
          ) => void;
        };
      };
    };
  }
}

interface IdNamePair {
  name: string;
  id: number;
}

interface ClassJson {
  name: string;
  id: number;
  labs: Array<IdNamePair>;
  lectures: Array<IdNamePair>;
}

interface DropDownOption {
  key: number;
  value: number;
  text: string;
}

interface OAuthConfig {
  google_client_id: string;
  google_enabled: boolean;
  microsoft_client_id: string;
  microsoft_authority: string;
  microsoft_enabled: boolean;
}

interface OAuthProfile {
  provider: "google" | "microsoft";
  email: string;
  first_name: string;
  last_name: string;
  display_name: string;
}

type NewUserSource = "pam" | "oauth" | null;

const GOOGLE_SCRIPT_SRC = "https://accounts.google.com/gsi/client";

function loadGoogleScript(): Promise<void> {
  return new Promise((resolve, reject) => {
    if (window.google?.accounts?.id) {
      resolve();
      return;
    }

    const existing = document.querySelector(`script[src="${GOOGLE_SCRIPT_SRC}"]`) as HTMLScriptElement | null;
    if (existing) {
      existing.addEventListener("load", () => resolve(), { once: true });
      existing.addEventListener("error", () => reject(new Error("Failed to load Google Sign-In script.")), {
        once: true,
      });
      return;
    }

    const script = document.createElement("script");
    script.src = GOOGLE_SCRIPT_SRC;
    script.async = true;
    script.defer = true;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error("Failed to load Google Sign-In script."));
    document.body.appendChild(script);
  });
}

function Login() {
  const apiBase = (import.meta.env.VITE_API_URL as string) || "";

  const storedToken = localStorage.getItem("AUTOTA_AUTH_TOKEN");
  const storedRole = localStorage.getItem("AUTOTA_USER_ROLE");
  const initialRole = storedRole !== null ? Number(storedRole) : -1;
  const initialLoggedIn = storedToken !== null && storedRole !== null;

  const [isLoggedIn, setIsLoggedIn] = useState<boolean>(initialLoggedIn);
  const [role, setRole] = useState<number>(Number.isNaN(initialRole) ? -1 : initialRole);

  const [username, setUsername] = useState<string>("");
  const [password, setPassword] = useState<string>("");
  const [errorMessage, setErrorMessage] = useState<string>("");
  const [isLoading, setIsLoading] = useState<boolean>(false);

  const [isNewUser, setIsNewUser] = useState<boolean>(false);
  const [newUserSource, setNewUserSource] = useState<NewUserSource>(null);
  const [newUserError, setNewUserError] = useState<string>("");

  const [firstName, setFirstName] = useState<string>("");
  const [lastName, setLastName] = useState<string>("");
  const [studentNumber, setStudentNumber] = useState<string>("");
  const [email, setEmail] = useState<string>("");

  const [classId, setClassId] = useState<number>(-1);
  const [labId, setLabId] = useState<number>(-1);
  const [lectureId, setLectureId] = useState<number>(-1);
  const [classes, setClasses] = useState<Array<ClassJson>>([]);
  const [classOptions, setClassOptions] = useState<Array<DropDownOption>>([]);
  const [labOptions, setLabOptions] = useState<Array<DropDownOption>>([]);
  const [lectureOptions, setLectureOptions] = useState<Array<DropDownOption>>([]);
  const [hasClassSelected, setHasClassSelected] = useState<boolean>(false);

  const [oauthConfig, setOAuthConfig] = useState<OAuthConfig | null>(null);
  const [oauthProfile, setOAuthProfile] = useState<OAuthProfile | null>(null);
  const [oauthSignupToken, setOAuthSignupToken] = useState<string>("");

  const googleButtonRef = useRef<HTMLDivElement | null>(null);

  const persistSession = useCallback((accessToken: string, userRole: number) => {
    localStorage.setItem("AUTOTA_AUTH_TOKEN", accessToken);
    localStorage.setItem("AUTOTA_USER_ROLE", String(userRole));
    setRole(userRole);
    setIsLoggedIn(true);
  }, []);

  const fetchSections = useCallback(async () => {
    try {
      const res = await axios.get(`${apiBase}/class/sections`);
      const sectionClasses = Array.isArray(res.data) ? (res.data as Array<ClassJson>) : [];

      setClasses(sectionClasses);
      setClassOptions(
        sectionClasses.map((cls) => ({
          key: cls.id,
          value: cls.id,
          text: cls.name,
        }))
      );

      if (sectionClasses.length === 0) {
        setNewUserError("No classes were returned from the server.");
      }
    } catch (err) {
      console.error(err);
      setNewUserError("Could not load class, lecture, and lab options.");
    }
  }, [apiBase]);

  useEffect(() => {
    if (isNewUser) {
      void fetchSections();
    }
  }, [isNewUser, fetchSections]);

  useEffect(() => {
    axios
      .get(`${apiBase}/auth/oauth/config`)
      .then((res) => setOAuthConfig(res.data as OAuthConfig))
      .catch(() => {
        setOAuthConfig({
          google_client_id: "",
          google_enabled: false,
          microsoft_client_id: "",
          microsoft_authority: "",
          microsoft_enabled: false,
        });
      });
  }, [apiBase]);

  const handleOAuthBackendLogin = useCallback(
    async (provider: "google" | "microsoft", idToken: string) => {
      setErrorMessage("");
      setIsLoading(true);

      try {
        const res = await axios.post(`${apiBase}/auth/oauth/login`, {
          provider,
          id_token: idToken,
        });

        if (res.data.message === "New OAuth User") {
          setIsNewUser(true);
          setNewUserSource("oauth");
          setOauthSignupToken(res.data.signup_token || "");
          setOauthProfile(res.data.oauth_profile || null);
          setFirstName(res.data.oauth_profile?.first_name || "");
          setLastName(res.data.oauth_profile?.last_name || "");
          setEmail(res.data.oauth_profile?.email || "");
          setNewUserError("");
        } else {
          persistSession(res.data.access_token, Number(res.data.role || 0));
        }
      } catch (err: any) {
        const msg = err.response?.data?.message || "OAuth login failed.";
        setErrorMessage(msg);
      } finally {
        setIsLoading(false);
      }
    },
    [apiBase, fetchSections, persistSession]
  );

  useEffect(() => {
    if (!oauthConfig?.google_enabled || !oauthConfig.google_client_id || !googleButtonRef.current) {
      return;
    }

    loadGoogleScript()
      .then(() => {
        if (!window.google?.accounts?.id || !googleButtonRef.current) {
          return;
        }

        googleButtonRef.current.innerHTML = "";
        window.google.accounts.id.initialize({
          client_id: oauthConfig.google_client_id,
          callback: (response) => {
            if (!response.credential) {
              setErrorMessage("Google login did not return an ID token.");
              return;
            }
            void handleOAuthBackendLogin("google", response.credential);
          },
        });

        window.google.accounts.id.renderButton(googleButtonRef.current, {
          theme: "outline",
          size: "large",
          shape: "rectangular",
          text: "continue_with",
          width: 360,
          logo_alignment: "left",
        });
      })
      .catch(() => {
        setErrorMessage("Failed to initialize Google Sign-In.");
      });
  }, [oauthConfig, handleOAuthBackendLogin]);

  const handlePasswordSubmit = async (ev: React.FormEvent<HTMLFormElement>) => {
    ev.preventDefault();

    setErrorMessage("");
    setIsLoading(true);

    try {
      const res = await axios.post(`${apiBase}/auth/login`, {
        username,
        password,
      });

      if (res.data.message === "New User") {
        setIsNewUser(true);
        setNewUserSource("pam");
        setOauthSignupToken("");
        setOauthProfile(null);
        setNewUserError("");
      } else {
        persistSession(res.data.access_token, Number(res.data.role || 0));
      }
    } catch (err: any) {
      const msg = err.response?.data?.message || "Login failed.";
      setErrorMessage(msg);
    } finally {
      setIsLoading(false);
    }
  };

  const handleMicrosoftLogin = async () => {
    if (!oauthConfig?.microsoft_enabled || !oauthConfig.microsoft_client_id || !oauthConfig.microsoft_authority) {
      setErrorMessage("Microsoft login is not configured.");
      return;
    }

    setErrorMessage("");
    setIsLoading(true);

    try {
      const msal = new PublicClientApplication({
        auth: {
          clientId: oauthConfig.microsoft_client_id,
          authority: oauthConfig.microsoft_authority,
          redirectUri: window.location.origin,
        },
        cache: {
          cacheLocation: "sessionStorage",
        },
      });

      await msal.initialize();

      const response = await msal.loginPopup({
        scopes: ["openid", "profile", "email", "User.Read"],
        prompt: "select_account",
      });

      if (!response.idToken) {
        throw new Error("Microsoft login did not return an ID token.");
      }

      await handleOAuthBackendLogin("microsoft", response.idToken);
    } catch (err: any) {
      const msg = err?.message || err?.response?.data?.message || "Microsoft login failed.";
      setErrorMessage(msg);
      setIsLoading(false);
    }
  };

  const handleClassIdChange = (value: number) => {
    const selectedClass = classes.find((cls) => cls.id === value);

    const newLabOptions = selectedClass
      ? selectedClass.labs.map((lab) => ({ key: lab.id, text: lab.name, value: lab.id }))
      : [];

    const newLectureOptions = selectedClass
      ? selectedClass.lectures.map((lec) => ({ key: lec.id, text: lec.name, value: lec.id }))
      : [];

    setClassId(value);
    setLabId(-1);
    setLectureId(-1);
    setHasClassSelected(value !== -1);
    setLabOptions(newLabOptions);
    setLectureOptions(newLectureOptions);
  };

  const handleNewUserSubmit = async (
    ev: React.FormEvent<HTMLFormElement> | React.MouseEvent<HTMLButtonElement>
  ) => {
    ev.preventDefault();

    setNewUserError("");
    setIsLoading(true);

    try {
      let res;

      if (newUserSource === "oauth") {
        res = await axios.post(`${apiBase}/auth/oauth/create`, {
          signup_token: oauthSignupToken,
          id: studentNumber,
          class_id: classId,
          lab_id: labId,
          lecture_id: lectureId,
        });
      } else {
        res = await axios.post(`${apiBase}/auth/create`, {
          username,
          password,
          fname: firstName,
          lname: lastName,
          id: studentNumber,
          email,
          class_id: classId,
          lab_id: labId,
          lecture_id: lectureId,
        });
      }

      persistSession(res.data.access_token, Number(res.data.role || 0));
    } catch (err: any) {
      const msg = err.response?.data?.message || "Account creation failed.";
      setNewUserError(msg);
    } finally {
      setIsLoading(false);
    }
  };

  if (isLoggedIn) {
    const redirectPath = role === 0 ? "/student/classes" : "/admin/classes";
    return <Navigate to={redirectPath} replace />;
  }

  return (
    <div className="login-page">
      <Helmet>
        <title>TA-Bot</title>
      </Helmet>

      {isNewUser ? (
        <div className="login-modal">
          <div className="login-modal__content" role="dialog" aria-modal="true">
            <h2 className="login-modal__title">
              {newUserSource === "oauth" ? "Finish creating your TA-Bot account" : "New User Registration"}
            </h2>

            {newUserSource === "oauth" && oauthProfile ? (
              <div className="oauth-profile-card">
                <div className="oauth-profile-card__label">Signed in with {oauthProfile.provider}</div>
                <div className="oauth-profile-card__name">{oauthProfile.display_name}</div>
                <div className="oauth-profile-card__email">{oauthProfile.email}</div>
                <div className="oauth-profile-card__hint">
                  Your name and school email came from your identity provider. You only need to finish your student
                  details below.
                </div>
              </div>
            ) : null}

            <form className="login-modal__form" onSubmit={handleNewUserSubmit}>
              {newUserSource !== "oauth" ? (
                <>
                  <div className="form-group">
                    <label className="form-label" htmlFor="fname">
                      First name
                    </label>
                    <input
                      id="fname"
                      type="text"
                      placeholder="First name"
                      value={firstName}
                      onChange={(e) => setFirstName(e.target.value)}
                      className="form-input"
                    />
                  </div>

                  <div className="form-group">
                    <label className="form-label" htmlFor="lname">
                      Last name
                    </label>
                    <input
                      id="lname"
                      type="text"
                      placeholder="Last name"
                      value={lastName}
                      onChange={(e) => setLastName(e.target.value)}
                      className="form-input"
                    />
                  </div>

                  <div className="form-group">
                    <label className="form-label" htmlFor="email">
                      School Email
                    </label>
                    <input
                      id="email"
                      type="email"
                      placeholder="first.last@marquette.edu"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      className="form-input"
                    />
                  </div>
                </>
              ) : null}

              <div className="form-group">
                <label className="form-label" htmlFor="sid">
                  School ID
                </label>
                <input
                  id="sid"
                  type="text"
                  placeholder="001234567"
                  value={studentNumber}
                  onChange={(e) => setStudentNumber(e.target.value)}
                  className="form-input"
                />
              </div>

              <div className="form-group">
                <label className="form-label" htmlFor="classSelect">
                  Class Name
                </label>
                <select
                  id="classSelect"
                  value={classId}
                  onChange={(e) => handleClassIdChange(parseInt(e.target.value, 10) || -1)}
                  className="form-select"
                >
                  <option value={-1}>Class</option>
                  {classOptions.map((opt) => (
                    <option key={opt.key} value={opt.value}>
                      {opt.text}
                    </option>
                  ))}
                </select>
              </div>

              <div className="form-group">
                <label className="form-label" htmlFor="lectureSelect">
                  Lecture Number
                </label>
                <select
                  id="lectureSelect"
                  value={lectureId}
                  onChange={(e) => setLectureId(parseInt(e.target.value, 10) || -1)}
                  disabled={!hasClassSelected}
                  className="form-select"
                >
                  <option value={-1}>Lecture</option>
                  {lectureOptions.map((opt) => (
                    <option key={opt.key} value={opt.value}>
                      {opt.text}
                    </option>
                  ))}
                </select>
              </div>

              <div className="form-group">
                <label className="form-label" htmlFor="labSelect">
                  Lab Number
                </label>
                <select
                  id="labSelect"
                  value={labId}
                  onChange={(e) => setLabId(parseInt(e.target.value, 10) || -1)}
                  disabled={!hasClassSelected}
                  className="form-select"
                >
                  <option value={-1}>Lab</option>
                  {labOptions.map((opt) => (
                    <option key={opt.key} value={opt.value}>
                      {opt.text}
                    </option>
                  ))}
                </select>
              </div>

              {newUserError ? (
                <div className="alert alert--error" role="alert" aria-live="assertive">
                  {newUserError}
                </div>
              ) : null}

              <button className="btn btn--primary" type="submit" disabled={isLoading}>
                {isLoading ? "Submitting..." : "Submit"}
              </button>
            </form>
          </div>
        </div>
      ) : null}

      <div className="login-card">
        <h1 className="login-title">Login to TA-Bot</h1>
        <p className="login-subtitle">Use your campus password, Google, or Microsoft.</p>

        <div className="oauth-section">
          {oauthConfig?.google_enabled ? (
            <div className="google-button-shell">
              <div ref={googleButtonRef} />
            </div>
          ) : null}

          {oauthConfig?.microsoft_enabled ? (
            <button className="btn btn--microsoft" type="button" onClick={handleMicrosoftLogin} disabled={isLoading}>
              <FaMicrosoft aria-hidden="true" />
              <span>{isLoading ? "Working..." : "Continue with Microsoft"}</span>
            </button>
          ) : null}
        </div>

        {(oauthConfig?.google_enabled || oauthConfig?.microsoft_enabled) ? (
          <div className="login-divider">
            <span>or use your campus account</span>
          </div>
        ) : null}

        <form className="login-form" onSubmit={handlePasswordSubmit}>
          <div className="form-group">
            <label className="form-label" htmlFor="username">
              Username
            </label>
            <div className="input-with-icon">
              <FaUser className="input-with-icon__icon" aria-hidden="true" />
              <input
                id="username"
                name="username"
                type="text"
                required
                placeholder="Username"
                autoComplete="username"
                onChange={(e) => setUsername(e.target.value)}
                className="form-input"
                value={username}
              />
            </div>
          </div>

          <div className="form-group">
            <label className="form-label" htmlFor="password">
              Password
            </label>
            <div className="input-with-icon">
              <FaLock className="input-with-icon__icon" aria-hidden="true" />
              <input
                id="password"
                name="password"
                type="password"
                required
                placeholder="Password"
                autoComplete="current-password"
                onChange={(e) => setPassword(e.target.value)}
                className="form-input"
                value={password}
              />
            </div>
          </div>

          <button className="btn btn--primary login-form__submit" type="submit" disabled={isLoading}>
            {isLoading ? "Logging in..." : "Login"}
          </button>
        </form>

        {errorMessage ? (
          <div className="alert alert--error" role="alert" aria-live="assertive">
            {errorMessage}
          </div>
        ) : null}

        <div className="login-links">
          Create a manual account{" "}
          <a
            className="login-links__link"
            href="https://docs.google.com/document/d/1QT--iGWE-y1Ix8GknsMAoiIKyZJcO_yEOhMBg0WFpyU/edit?usp=sharing"
            target="_blank"
            rel="noreferrer"
          >
            here
          </a>
          .
        </div>

        <div className="login-logo">
          <img className="login-logo__img" src={img} alt="School logo" />
        </div>
      </div>
    </div>
  );
}

export default Login;