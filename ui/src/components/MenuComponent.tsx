import { Component } from 'react'
import 'semantic-ui-css/semantic.min.css'
import { Menu, Container, Icon, Button, Popup } from 'semantic-ui-react'
import axios from 'axios'

interface MenuComponentProps {
    showUpload: boolean;
    showAdminUpload: boolean;
    showHelp: boolean;
    showCreate: boolean;
    showReviewButton: boolean;
    showLast: boolean;
}

class MenuComponent extends Component<MenuComponentProps> {
    style = {
        maxWidth: '300px',
        padding: '1em',
        lineHeight: '1.5',
    };

    // Logout and redirect
    handleLogout = () => {
        localStorage.removeItem('AUTOTA_AUTH_TOKEN');
        window.location.replace('/login');
    };

    // Home routing based on role
    handleHome = () => {
        axios
            .get(`${import.meta.env.VITE_API_URL}/auth/get-role`, {
                headers: {
                    Authorization: `Bearer ${localStorage.getItem('AUTOTA_AUTH_TOKEN')}`,
                },
            })
            .then((res) => {
                const role = parseInt(res.data, 10);
                const path = role === 1 ? '/admin/classes' : '/class/classes';
                window.location.replace(path);
            });
    };

    // Compute dynamic class upload ID (more general: any /class/:id/... path)
    getClassIdFromUrl(): string | null {
        const match = window.location.href.match(/\/class\/(\d+)/);
        return match ? match[1] : null;
    }

    render() {
        const classId = this.getClassIdFromUrl();
        const recentPath = classId ? `/class/${classId}/code` : '/class/classes';
        const officeHoursPath = classId ? `/class/OfficeHours/${classId}` : '/class/classes';

        return (
            <Menu
                fixed="top"
                inverted
                borderless
                size="huge"
                style={{
                    borderRadius: 0,
                    boxShadow: '0 2px 5px rgba(0,0,0,0.3)',
                    padding: '0rem 0',
                    fontSize: '1.125rem',
                }}
            >
                <Container style={{ width: '90%', margin: '0 auto' }}>
                    <Menu.Item header onClick={this.handleHome} style={{ fontSize: '2rem', fontWeight: 'bold' }}>
                        TA-Bot
                    </Menu.Item>

                    {this.props.showAdminUpload && (
                        <>
                            <Menu.Item as="a" href="/admin/upload">
                                <Icon name="upload" size="large" /> Admin Upload
                            </Menu.Item>
                            <Menu.Item as="a" href="/admin/TaLanding">
                                <Icon name="graduation cap" size="large" /> Office Hours
                            </Menu.Item>
                        </>
                    )}

                    {this.props.showLast && (
                        <>
                            <Menu.Item as="a" href={officeHoursPath}>
                                <Icon name="graduation cap" size="large" /> Office Hours
                            </Menu.Item>
                            <Menu.Item as="a" href="/submissions">
                                <Icon name="list alternate" size="large" /> Submissions
                            </Menu.Item>
                        </>
                    )}

                    {/* Right aligned menu */}
                    <Menu.Menu position="right">
                        {this.props.showCreate && (
                            <Menu.Item as="a" href="/admin/project/edit/0">
                                <Icon name="plus circle" /> Create Assignment
                            </Menu.Item>
                        )}

                        <Menu.Item link onClick={this.handleLogout} title="Log Out">
                            <Icon name="sign-out" size="large" />
                            Log Out
                        </Menu.Item>
                    </Menu.Menu>
                </Container>
            </Menu>
        );
    }
}

export default MenuComponent;