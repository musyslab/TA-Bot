import { Component } from 'react';
import 'semantic-ui-css/semantic.min.css';
import AccountCreationPageComponent from '../components/AccountCreationPageComponent';
import React from 'react';

class AccountCreationPage extends Component {
    render() {
        return (
            <div id="AccountCreationPage">
                <AccountCreationPageComponent></AccountCreationPageComponent>
            </div>
        );
    }
}

export default AccountCreationPage;