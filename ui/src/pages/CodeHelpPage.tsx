import { useEffect, useState } from 'react';
import 'semantic-ui-css/semantic.min.css';
import '../css/CodePage.scss';
import CodeHelpComponent from '../components/CodeHelpComponent';
import MenuComponent from '../components/MenuComponent';
import axios from 'axios';
import { useParams } from 'react-router-dom';
import Split from 'react-split';
import { Helmet, HelmetProps } from "react-helmet";
import React from 'react';

// Cast Helmet to a functional component to bypass the missing refs issue
const SafeHelmet: React.FC<HelmetProps> = Helmet as any;

const defaultpagenumber = -1;

interface CodePageProps extends Record<string, string | undefined> {
  id?: string;
  class_id?: string;
}

interface JsonTestResponseBody {
  output: string[];
  type: number;
  description: string;
  name: string;
  suite: string;
  hidden: string;
}

interface JsonResponseBody {
  skipped: boolean;
  passed: boolean;
  test: JsonTestResponseBody;
}

interface JsonResponse {
  results: JsonResponseBody[];
}

const CodeHelpPage = () => {
  let { id, class_id } = useParams<CodePageProps>();
  const submissionId = id ? parseInt(id) : defaultpagenumber;
  const cid = class_id ? parseInt(class_id) : -1;

  const [json, setJson] = useState<JsonResponse>({
    results: [
      {
        skipped: false,
        passed: false,
        test: { description: "", output: [""], type: 0, name: "", suite: "", hidden: "" }
      }
    ]
  });
  const [code, setCode] = useState<string>("");

  useEffect(() => {
    // Fetch testcase errors
    axios
      .get(
        process.env.REACT_APP_BASE_API_URL +
          `/submissions/testcaseerrors?id=${submissionId}&class_id=${cid}`,
        {
          headers: {
            Authorization: `Bearer ${localStorage.getItem("AUTOTA_AUTH_TOKEN")}`
          }
        }
      )
      .then((res) => {
        setJson(res.data as JsonResponse);
        console.log(res.data);
      })
      .catch((err) => {
        console.log(err);
      });

    // Fetch code data
    axios
      .get(
        process.env.REACT_APP_BASE_API_URL +
          `/submissions/codefinder?id=${submissionId}&class_id=${cid}`,
        {
          headers: {
            Authorization: `Bearer ${localStorage.getItem("AUTOTA_AUTH_TOKEN")}`
          }
        }
      )
      .then((res) => {
        setCode(res.data as string);
      })
      .catch((err) => {
        console.log(err);
      });
  }, [submissionId, cid]);

  return (
    <div id="codehelp-page">
      <SafeHelmet>
        <title>Submission | TA-Bot</title>
      </SafeHelmet>
      <MenuComponent
        showUpload={true}
        showAdminUpload={false}
        showHelp={false}
        showCreate={false}
        showLast={false}
        showReviewButton={false}
      />
      <Split sizes={[80, 20]} className="split2" direction="vertical">
        <CodeHelpComponent codedata={code} />
      </Split>
    </div>
  );
};

export default CodeHelpPage;
