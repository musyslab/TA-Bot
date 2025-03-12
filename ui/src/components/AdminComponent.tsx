import { Component } from 'react';
import 'semantic-ui-css/semantic.min.css';
import { Grid } from 'semantic-ui-react';
import MenuComponent from '../components/MenuComponent';
import '../css/AdminComponent.scss';
import { Helmet } from "react-helmet";
import AdminComponent from '../components/AdminComponent';
import { useParams } from 'react-router-dom';
import React from 'react';

// Cast Helmet to `any` to avoid TypeScript issue
const SafeHelmet: any = Helmet;

function withParams(Component: any) {
  return (props: any) => {
    const params = useParams();
    return <Component {...props} params={params} />;
  };
}

interface AdminProjectProps {
  params?: {
    id: string;
  };
}

class AdminProject extends Component<AdminProjectProps, {}> {
  render() {
    const id = this.props.params?.id;
    
    return (
      <div>
        <div>hi</div>
        <SafeHelmet>
          <title>[Admin] Projects | TA-Bot</title>
        </SafeHelmet>
        <MenuComponent 
          showUpload={false} 
          showAdminUpload={true} 
          showHelp={false} 
          showCreate={false} 
          showLast={false} 
          showReviewButton={false} 
        />
        <Grid className="main-grid">
          <AdminComponent id={id} />
        </Grid>
      </div>
    );
  }
}

export default withParams(AdminProject);
