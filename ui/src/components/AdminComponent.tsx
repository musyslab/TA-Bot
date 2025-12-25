import { Component } from 'react'
import axios from 'axios'
import { Icon } from 'semantic-ui-react'
import { Link, useParams } from 'react-router-dom'
import '../css/AdminComponent.scss'

interface ProjectObject {
  Id: number;
  Name: string;
  Start: string;
  End: string;
  TotalSubmissions: number;
}

interface AdminComponentProps {
  classId: string;
}

interface ProjectsState {
  projects: ProjectObject[];
  open: boolean;
}

class AdminComponent extends Component<AdminComponentProps, ProjectsState> {
  constructor(props: AdminComponentProps) {
    super(props);
    this.state = {
      projects: [],
      open: false,
    };
  }

  private formatDate12h = (value: string): string => {
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return value;
    return new Intl.DateTimeFormat('en-US', {
      year: 'numeric',
      month: 'short',
      day: '2-digit',
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
    }).format(d);
  };

  componentDidMount() {
    const classId = this.props.classId;
    axios
      .get(
        `${import.meta.env.VITE_API_URL}/projects/get_projects_by_class_id?id=${classId}`,
        {
          headers: {
            Authorization: `Bearer ${localStorage.getItem('AUTOTA_AUTH_TOKEN')}`,
          },
        }
      )
      .then((res) => {
        const projects = res.data.map((str: any) => JSON.parse(str) as ProjectObject);
        this.setState({ projects });
      })
      .catch((err) => {
        console.log(err);
      });
  }

  private handleExport(projectId: number) {
    axios
      .get(
        `${import.meta.env.VITE_API_URL}/projects/export_project_submissions?id=${projectId}`,
        {
          headers: {
            Authorization: `Bearer ${localStorage.getItem('AUTOTA_AUTH_TOKEN')}`,
          },
          responseType: 'blob',
        }
      )
      .then((res) => {
        const url = window.URL.createObjectURL(new Blob([res.data]));
        const link = document.createElement('a');
        link.href = url;
        link.setAttribute('download', 'StudentSubmissions.zip');
        document.body.appendChild(link);
        link.click();
      })
      .catch((err) => console.log(err));
  }

  /** Returns true if today's date is within [Start, End] inclusive (both parseable). */
  private isProjectActive = (p: ProjectObject): boolean => {
    const startMs = Date.parse(p.Start);
    const endMs = Date.parse(p.End);
    if (Number.isNaN(startMs) || Number.isNaN(endMs)) return false;
    const now = Date.now();
    return now >= startMs && now <= endMs;
  };

  render() {
    // Sort projects by Project Start Date from earliest to latest (ascending).
    // If a date fails to parse, push it to the end to avoid breaking order.
    const projectsByStartAsc = [...this.state.projects].sort((a, b) => {
      const da = Date.parse(a.Start);
      const db = Date.parse(b.Start);
      const aInvalid = Number.isNaN(da);
      const bInvalid = Number.isNaN(db);
      if (aInvalid && bInvalid) return 0;
      if (aInvalid) return 1;
      if (bInvalid) return -1;
      return da - db;
    });

    return (
      <div className="projects-page">

        <div className="back-container">
          <Link to="/admin/classes" className="back-button">
            <span className="icon-arrow-left" aria-hidden="true" />
            Return to Class Selection
          </Link>
        </div>

        {/* New centered header */}
        <div className="projects-title">Project List</div>

        <table className="projects-table">
          <thead className="projects-table-head">
            <tr className="projects-table-row">
              <th className="projects-table-header">
                Project Name
              </th>
              <th className="projects-table-header">
                Project Start Date
              </th>
              <th className="projects-table-header">
                Project End Date
              </th>
              <th className="projects-table-header">
                Total Submissions
              </th>
              {/* <th className="projects-table-header">
                <Icon name="chart bar" />
                <span className="header-text">Project Analytics</span>
              </th> */}
              {/* <th className="projects-table-header">Project Analytics</th> */}
              <th className="projects-table-header">Review Submissions</th>
              <th className="projects-table-header">Edit Project</th>
              {/* <th className="projects-table-header">Export Project</th> */}
            </tr>
          </thead>

          <tbody className="projects-table-body">
            {projectsByStartAsc.map((project) => {
              const isActive = this.isProjectActive(project);
              return (
                <tr
                  className={`project-row${isActive ? ' is-active' : ''}`}
                  key={project.Id}
                  aria-current={isActive ? 'true' : undefined}
                >
                  <td className="project-name">
                    {project.Name}
                    {isActive && (
                      <span
                        className="badge-active"
                        title="Project is active today"
                        aria-label="Project is active today"
                      >
                        ● Active
                      </span>
                    )}
                  </td>
                  <td className="project-start">{this.formatDate12h(project.Start)}</td>
                  <td className="project-end">{this.formatDate12h(project.End)}</td>
                  <td className="project-total-submissions">{project.TotalSubmissions}</td>
                  <td className="project-review">
                    <Link className="button button-review" to={`/admin/project/${project.Id}`}>
                      <Icon name="eye" />
                      <span className="button-text">Review</span>
                    </Link>
                  </td>
                  <td className="project-edit">
                    <Link
                      className="button button-edit"
                      to={`/admin/project/edit/${this.props.classId}/${project.Id}`}
                    >
                      <Icon name="edit" />
                      <span className="button-text">Edit</span>
                    </Link>
                  </td>
                  {/* <td className="project-export">
                    <button
                      type="button"
                      className="button button-export"
                      onClick={() => this.handleExport(project.Id)}
                    >
                      <Icon name="file archive" />
                      <span className="button-text">Export</span>
                    </button>
                  </td>
                  */}
                </tr>
              );
            })}
          </tbody>
        </table>

        <Link
          className="button button-create-assignment"
          to={`/admin/project/edit/${this.props.classId}/0`}
        >
          <Icon name="plus circle" />
          <span className="button-text">Create new assignment</span>
        </Link>
      </div>
    );
  }
}

function AdminComponentWithParams() {
  const { id } = useParams<{ id: string }>();
  return <AdminComponent classId={id || ''} />;
}

export default AdminComponentWithParams;
