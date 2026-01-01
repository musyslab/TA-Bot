import React, { Component } from "react";

// Uncomment for Marquette
import img from "../../images/MUCS-tag.png";

// Uncomment for Carroll
// import img from "../../Pioneer.png";

import { FaUser, FaLock } from "react-icons/fa";

import "../../styling/Login.scss";

import axios from "axios";
import { Helmet } from "react-helmet";
import { Navigate } from "react-router-dom";

interface LoginPageState {
  isLoggedIn: boolean;
  isErrorMessageHidden: boolean;
  isNewUser: boolean;
  username: string;
  password: string;
  role: number;
  error_message: string;
  isLoading: boolean;

  // NewUserModal state (inlined)
  FirstName: string;
  LastName: string;
  StudentNumber: string;
  Email: string;
  ClassId: number;
  LabId: number;
  LectureId: number;
  classes: Array<ClassJson>;
  hasClassSelected: boolean;
  new_user_error_msg: string;
  classOptions: Array<DropDownOption>;
  labOptions: Array<DropDownOption>;
  lectureOptions: Array<DropDownOption>;
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

class Login extends Component<{}, LoginPageState> {
  constructor(props: {}) {
    super(props);

    this.state = {
      // login state
      isLoggedIn: localStorage.getItem("AUTOTA_AUTH_TOKEN") !== null,
      isErrorMessageHidden: true,
      isNewUser: false,
      username: "",
      password: "",
      role: -1,
      error_message: "",
      isLoading: false,

      // modal state
      FirstName: "",
      LastName: "",
      StudentNumber: "",
      Email: "",
      ClassId: -1,
      LabId: -1,
      LectureId: -1,
      classes: [],
      hasClassSelected: false,
      new_user_error_msg: "",
      classOptions: [],
      labOptions: [],
      lectureOptions: [],
    };

    // login handlers
    this.handleSubmit = this.handleSubmit.bind(this);
    this.handleUsernameChange = this.handleUsernameChange.bind(this);
    this.handlePasswordChange = this.handlePasswordChange.bind(this);

    // modal handlers
    this.handleFirstNameChange = this.handleFirstNameChange.bind(this);
    this.handleLastNameChange = this.handleLastNameChange.bind(this);
    this.handleEmailChange = this.handleEmailChange.bind(this);
    this.handleStudentNumberChange = this.handleStudentNumberChange.bind(this);
    this.handleClassIdChange = this.handleClassIdChange.bind(this);
    this.handleLabIdChange = this.handleLabIdChange.bind(this);
    this.handleLectureIdChange = this.handleLectureIdChange.bind(this);
    this.handleNewUserSubmit = this.handleNewUserSubmit.bind(this);
  }

  // -----------------------------
  // Login handlers
  // -----------------------------
  handleUsernameChange(ev: React.ChangeEvent<HTMLInputElement>) {
    this.setState({ username: ev.target.value });
  }

  handlePasswordChange(ev: React.ChangeEvent<HTMLInputElement>) {
    this.setState({ password: ev.target.value });
  }

  handleSubmit(ev?: React.FormEvent<HTMLFormElement>) {
    ev?.preventDefault();

    const baseUrl = import.meta.env.VITE_API_URL as string | undefined;

    this.setState({ isErrorMessageHidden: true, isLoading: true });

    axios
      .post(`${baseUrl}/auth/login`, {
        password: this.state.password,
        username: this.state.username,
      })
      .then((res) => {
        localStorage.setItem("AUTOTA_AUTH_TOKEN", res.data.access_token);
        if (res.data.message === "New User") {
          this.setState({ isNewUser: true, isLoading: false }, () => {
            // load dropdown data once the modal is shown
            this.fetchSections();
          });
        } else {
          this.setState({ isLoggedIn: true, role: res.data.role, isLoading: false });
        }
      })
      .catch((err) => {
        const msg = err.response?.data?.message || "Login failed.";
        this.setState({ error_message: msg, isErrorMessageHidden: false, isLoading: false });
      });
  }

  // -----------------------------
  // New user modal data + handlers
  // -----------------------------
  fetchSections() {
    const apiBase = (import.meta.env.VITE_API_URL as string) || "";

    axios
      .get(`${apiBase}/class/sections`, {
        headers: {
          Authorization: `Bearer ${localStorage.getItem("AUTOTA_AUTH_TOKEN")}`,
        },
      })
      .then((res) => {
        const classes: Array<ClassJson> = res.data as Array<ClassJson>;
        const classOptions: Array<DropDownOption> = classes.map((cls) => ({
          key: cls.id,
          value: cls.id,
          text: cls.name,
        }));
        this.setState({ classes, classOptions });
      })
      .catch((err) => {
        console.log(err);
      });
  }

  handleFirstNameChange(ev: React.ChangeEvent<HTMLInputElement>) {
    this.setState({ FirstName: ev.target.value });
  }

  handleLastNameChange(ev: React.ChangeEvent<HTMLInputElement>) {
    this.setState({ LastName: ev.target.value });
  }

  handleEmailChange(ev: React.ChangeEvent<HTMLInputElement>) {
    this.setState({ Email: ev.target.value });
  }

  handleStudentNumberChange(ev: React.ChangeEvent<HTMLInputElement>) {
    this.setState({ StudentNumber: ev.target.value });
  }

  handleClassIdChange(value: number) {
    const selectedClass = this.state.classes.find((cls) => cls.id === value);

    const labOptions = selectedClass
      ? selectedClass.labs.map((lab) => ({ key: lab.id, text: lab.name, value: lab.id }))
      : [];

    const lectureOptions = selectedClass
      ? selectedClass.lectures.map((lec) => ({ key: lec.id, text: lec.name, value: lec.id }))
      : [];

    this.setState({
      ClassId: value,
      LabId: -1,
      LectureId: -1,
      hasClassSelected: value !== -1,
      labOptions,
      lectureOptions,
    });
  }

  handleLabIdChange(value: number) {
    this.setState({ LabId: value });
  }

  handleLectureIdChange(value: number) {
    this.setState({ LectureId: value });
  }

  handleNewUserSubmit(ev: React.FormEvent<HTMLFormElement> | React.MouseEvent<HTMLButtonElement>) {
    ev.preventDefault();

    const apiBase = (import.meta.env.VITE_API_URL as string) || "";

    // Original code checked password twice; keep intent but fix to username+password.
    const useCreate = this.state.username !== "NAN" && this.state.password !== "NAN";
    const endpoint = useCreate ? "/auth/create" : "/auth/create_newclass";

    axios
      .post(`${apiBase}${endpoint}`, {
        password: this.state.password,
        username: this.state.username,
        fname: this.state.FirstName,
        lname: this.state.LastName,
        id: this.state.StudentNumber,
        email: this.state.Email,
        class_id: this.state.ClassId,
        lab_id: this.state.LabId,
        lecture_id: this.state.LectureId,
      })
      .then((res) => {
        localStorage.setItem("AUTOTA_AUTH_TOKEN", res.data.access_token);
        window.location.href = "/class/classes";
      })
      .catch((err) => {
        const msg = err.response?.data?.message || "Account creation failed.";
        this.setState({ new_user_error_msg: msg });
      });
  }

  render() {
    if (this.state.isLoggedIn) {
      const redirectPath = this.state.role === 0 ? "/class/classes" : "/admin/classes";
      return <Navigate to={redirectPath} replace />;
    }

    const lectureDisabled = !this.state.hasClassSelected;
    const labDisabled = !this.state.hasClassSelected;

    return (
      <div className="login-page">
        <Helmet>
          <title>TA-Bot</title>
        </Helmet>

        {this.state.isNewUser ? (
          <div className="login-modal">
            <div className="login-modal__content" role="dialog" aria-modal="true">
              <h2 className="login-modal__title">New User Registration</h2>

              <form className="login-modal__form" onSubmit={this.handleNewUserSubmit}>
                <div className="form-group">
                  <label className="form-label" htmlFor="fname">
                    First name
                  </label>
                  <input
                    id="fname"
                    type="text"
                    placeholder="First name"
                    value={this.state.FirstName}
                    onChange={this.handleFirstNameChange}
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
                    value={this.state.LastName}
                    onChange={this.handleLastNameChange}
                    className="form-input"
                  />
                </div>

                <div className="form-group">
                  <label className="form-label" htmlFor="sid">
                    School ID
                  </label>
                  <input
                    id="sid"
                    type="text"
                    placeholder="001234567"
                    value={this.state.StudentNumber}
                    onChange={this.handleStudentNumberChange}
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
                    value={this.state.Email}
                    onChange={this.handleEmailChange}
                    className="form-input"
                  />
                </div>

                <div className="form-group">
                  <label className="form-label" htmlFor="classSelect">
                    Class Name
                  </label>
                  <select
                    id="classSelect"
                    value={this.state.ClassId}
                    onChange={(e) => this.handleClassIdChange(parseInt(e.target.value, 10) || -1)}
                    className="form-select"
                  >
                    <option value={-1}>Class</option>
                    {this.state.classOptions.map((opt) => (
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
                    value={this.state.LectureId}
                    onChange={(e) => this.handleLectureIdChange(parseInt(e.target.value, 10) || -1)}
                    disabled={lectureDisabled}
                    className="form-select"
                  >
                    <option value={-1}>Lecture</option>
                    {this.state.lectureOptions.map((opt) => (
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
                    value={this.state.LabId}
                    onChange={(e) => this.handleLabIdChange(parseInt(e.target.value, 10) || -1)}
                    disabled={labDisabled}
                    className="form-select"
                  >
                    <option value={-1}>Lab</option>
                    {this.state.labOptions.map((opt) => (
                      <option key={opt.key} value={opt.value}>
                        {opt.text}
                      </option>
                    ))}
                  </select>
                </div>

                {this.state.new_user_error_msg ? (
                  <div className="alert alert--error" role="alert" aria-live="assertive">
                    {this.state.new_user_error_msg}
                  </div>
                ) : null}

                <button className="btn btn--primary" type="submit" onClick={this.handleNewUserSubmit}>
                  Submit
                </button>
              </form>
            </div>
          </div>
        ) : null}

        <h2 className="login-title">Login to your MSCSNet account</h2>

        <form className="login-form" onSubmit={this.handleSubmit}>
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
                onChange={this.handleUsernameChange}
                className="form-input"
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
                onChange={this.handlePasswordChange}
                className="form-input"
              />
            </div>
          </div>

          <button className="btn btn--primary login-form__submit" type="submit" disabled={this.state.isLoading}>
            {this.state.isLoading ? "Logging in…" : "Login"}
          </button>
        </form>

        {!this.state.isErrorMessageHidden && this.state.error_message ? (
          <div className="alert alert--error" role="alert" aria-live="assertive">
            {this.state.error_message}
          </div>
        ) : null}

        <div className="login-links">
          Create an account{" "}
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
    );
  }
}

export default Login;
