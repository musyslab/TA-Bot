import React, { Component } from 'react';
import 'semantic-ui-css/semantic.min.css'
import mscsimg from '../MUCS-tag.png'
import axios from 'axios';
import ErrorMessage from '../components/ErrorMessage';
import NewUserModal from '../components/NewUserModal';
import { Navigate } from 'react-router-dom';
import { Button, Form, Grid, Header, Message, Image, Segment } from 'semantic-ui-react'
import { Helmet } from 'react-helmet';
import '../css/Login.scss';

interface LoginPageState {
  isLoggedIn: boolean,
  isErrorMessageHidden: boolean,
  isNewUser: boolean,
  username: string,
  password: string,
  role: number,
  error_message: string,
  isLoading: boolean
}

class Login extends Component<{}, LoginPageState> {

  constructor(props: any) {
    super(props);

    this.state = {
      isLoggedIn: localStorage.getItem("AUTOTA_AUTH_TOKEN") != null,
      isErrorMessageHidden: true,
      username: '',
      password: '',
      role: -1,
      isNewUser: false,
      error_message: '',
      isLoading: false
    }

    this.handleSubmit = this.handleSubmit.bind(this);
    this.handleUsernameChange = this.handleUsernameChange.bind(this);
    this.handlePasswordChange = this.handlePasswordChange.bind(this);
  }

  handleUsernameChange(ev: React.ChangeEvent<HTMLInputElement>) {
    this.setState({ username: ev.target.value });
  }

  handlePasswordChange(ev: React.ChangeEvent<HTMLInputElement>) {
    this.setState({ password: ev.target.value });
  }

  handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    this.setState({ isErrorMessageHidden: true, isLoading: true });

    axios
      .post(`${import.meta.env.VITE_API_URL}/auth/login`, {
        username: this.state.username,
        password: this.state.password,
      })
      .then(res => {
        // stop loading spinner
        this.setState({ isLoading: false });

        if (res.data.message === "New User") {
          this.setState({ isNewUser: true });
        }
        else if (res.data.message === "Success" && res.data.access_token) {
          localStorage.setItem("AUTOTA_AUTH_TOKEN", res.data.access_token);
          this.setState({ isLoggedIn: true, role: res.data.role });
        }
        else {
          this.setState({
            error_message: "Unexpected response from server",
            isErrorMessageHidden: false
          });
        }
      })
      .catch(err => {
        const msg = err.response?.data?.message ?? "Server error";
        this.setState({
          error_message: msg,
          isErrorMessageHidden: false,
          isLoading: false
        });
      });
  }

  render() {
    if (this.state.isLoggedIn && this.state.role === 0) {
      return <Navigate to="/class/classes" replace />;
    }
    if (this.state.isLoggedIn && this.state.role === 1) {
      return <Navigate to="/admin/classes" replace />;
    }
    if (this.state.isLoggedIn && this.state.role === 2) {
      return <Navigate to="/admin/TaLanding" replace />;
    }

    return (
      <div>
        <Helmet>
          <title>Login | TA-Bot</title>
        </Helmet>
        <NewUserModal username={this.state.username} password={this.state.password} isOpen={this.state.isNewUser}></NewUserModal>
        <Grid>
          <Grid.Column>
            <Header as='h2'>
              Login to your MSCSNet account
            </Header>
            <Form onSubmit={this.handleSubmit}>
              <Segment>
                <Form.Input
                  icon="user"
                  iconPosition="left"
                  required
                  placeholder="Username"
                  onChange={this.handleUsernameChange}
                />
                <Form.Input
                  icon="lock"
                  iconPosition="left"
                  required
                  placeholder="Password"
                  type="password"
                  onChange={this.handlePasswordChange}
                />

                <Button type="submit">Login</Button>
              </Segment>
            </Form>

            <ErrorMessage message={this.state.error_message} isHidden={this.state.isErrorMessageHidden} ></ErrorMessage>
            <Message>
              Create an account <a href='https://drive.google.com/file/d/1VlA4wRcizy4VpFZuMQQ0V9Fnmq-l5vcm/view?usp=sharing' target="_blank" rel="noreferrer">here</a>.
            </Message>
            <div>
              <Image src={mscsimg} />
            </div>
          </Grid.Column>
        </Grid>
      </div>
    );
  }
}

export default Login;
