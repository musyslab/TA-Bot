import React, { Component } from 'react'
import 'semantic-ui-css/semantic.min.css'
import mscsimg from '../MUCS-tag.png'
import axios from 'axios'
import ErrorMessage from '../components/ErrorMessage'
import NewUserModal from '../components/NewUserModal'
import { Button, Form, Grid, Header, Message, Image, Segment } from 'semantic-ui-react'
import { Helmet } from 'react-helmet'
import { Navigate } from 'react-router-dom'
import '../css/Login.scss'

interface LoginPageState {
  isLoggedIn: boolean;
  isErrorMessageHidden: boolean;
  isNewUser: boolean;
  username: string;
  password: string;
  role: number;
  error_message: string;
  isLoading: boolean;
}

class Login extends Component<{}, LoginPageState> {
  constructor(props: {}) {
    super(props);
    this.state = {
      isLoggedIn: localStorage.getItem('AUTOTA_AUTH_TOKEN') !== null,
      isErrorMessageHidden: true,
      username: '',
      password: '',
      role: -1,
      isNewUser: false,
      error_message: '',
      isLoading: false,
    };

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
        localStorage.setItem('AUTOTA_AUTH_TOKEN', res.data.access_token);
        if (res.data.message === 'New User') {
          this.setState({ isNewUser: true, isLoading: false });
        } else {
          this.setState({ isLoggedIn: true, role: res.data.role, isLoading: false });
        }
      })
      .catch((err) => {
        const msg = err.response?.data?.message || 'Login failed.';
        this.setState({ error_message: msg, isErrorMessageHidden: false, isLoading: false });
      });
  }

  render() {
    if (this.state.isLoggedIn) {
      const redirectPath =
        this.state.role === 0
          ? '/class/classes'
          : this.state.role === 1
            ? '/admin/classes'
            : '/admin/TaLanding';

      return <Navigate to={redirectPath} replace />;
    }

    return (
      <div>
        <Helmet>
          <title>Login | TA-Bot</title>
        </Helmet>
        <NewUserModal
          username={this.state.username}
          password={this.state.password}
          isOpen={this.state.isNewUser}
        />
        <Grid textAlign="center" verticalAlign="middle" style={{ height: '100vh' }}>
          <Grid.Column style={{ maxWidth: 450 }}>
            <Header as="h2">Login to your MSCSNet account</Header>
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
                <Button type="submit" loading={this.state.isLoading} disabled={this.state.isLoading}>
                  Login
                </Button>
              </Segment>
            </Form>

            <ErrorMessage message={this.state.error_message} isHidden={this.state.isErrorMessageHidden} />
            <Message>
              Create an account{' '}
              <a
                href="https://drive.google.com/file/d/1VlA4wRcizy4VpFZuMQQ0V9Fnmq-l5vcm/view?usp=sharing"
                target="_blank"
                rel="noreferrer"
              >
                here
              </a>
              .
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