import { useEffect, useState } from 'react';
import 'semantic-ui-css/semantic.min.css';
import '../css/CodePage.scss';
import CodeComponent from '../components/CodeComponent';
import TestResultsComponent from '../components/TestResultsComponent';
import MenuComponent from '../components/MenuComponent';
import axios from 'axios';
import { useParams } from 'react-router-dom';
import Split from 'react-split';
import { Helmet, HelmetProps } from "react-helmet";
import React from 'react';

// Create a SafeHelmet component by casting Helmet to a functional component
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

interface PylintObject {
  type: string;
  module: string;
  obj: string;
  line: number;
  column: number;
  path: string;
  symbol: string;
  message: string;
  messageid: string;
  reflink: string;
}
interface gptobject {
  type: string;
  message: string;
}

const CodePage = () => {
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
  const [pylint, setPylint] = useState<Array<PylintObject>>([]);
  const [gptresponsedata, setgptresponsedata] = useState<Array<gptobject>>([]);
  const [code, setCode] = useState<string>("");
  const [score, setScore] = useState<number>(0);
  const [hasScoreEnabled, setHasScoreEnabled] = useState<boolean>(false);
  const [hasUnlockEnabled, setHasUnlockEnabled] = useState<boolean>(false);
  const [hasTbsEnabled, setHasTbsEnabled] = useState<boolean>(false);
  const [ResearchGroup, setResearchGroup] = useState<number>(0);
  const [lint, setLint] = useState<string>("");

  useEffect(() => {
    axios
      .get(process.env.REACT_APP_BASE_API_URL + `/submissions/testcaseerrors?id=${submissionId}&class_id=${cid}`, {
        headers: {
          'Authorization': `Bearer ${localStorage.getItem("AUTOTA_AUTH_TOKEN")}`
        }
      })
      .then(res => {
        setJson(res.data as JsonResponse);
        console.log(res.data);
      })
      .catch(err => {
        console.log(err);
      });

    axios
      .get(process.env.REACT_APP_BASE_API_URL + `/submissions/get-score?id=${submissionId}`, {
        headers: {
          'Authorization': `Bearer ${localStorage.getItem("AUTOTA_AUTH_TOKEN")}`
        }
      })
      .then(res => {
        setScore(res.data);
      })
      .catch(err => {
        console.log(err);
      });

    axios
      .get(process.env.REACT_APP_BASE_API_URL + `/submissions/lint_output?id=${submissionId}&class_id=${cid}`, {
        headers: {
          'Authorization': `Bearer ${localStorage.getItem("AUTOTA_AUTH_TOKEN")}`
        }
      })
      .then(res => {
        let x = res.data as Array<PylintObject>;
        console.log("THIS IS X");
        console.log("X:", x);
        if (Array.isArray(x)) {
          x = x.sort((a, b) => (a.line < b.line ? -1 : 1));
          console.log("X sorted:", x);
        } else {
          console.error("x is not an array. Skipping the sorting step.");
        }
        setPylint(x);
        console.log(x);
      })
      .catch(err => {
        console.log(err);
      });

    axios
      .get(process.env.REACT_APP_BASE_API_URL + `/submissions/codefinder?id=${submissionId}&class_id=${cid}`, {
        headers: {
          'Authorization': `Bearer ${localStorage.getItem("AUTOTA_AUTH_TOKEN")}`
        }
      })
      .then(res => {
        setCode(res.data as string);
      })
      .catch(err => {
        console.log(err);
      });

    axios
      .get(process.env.REACT_APP_BASE_API_URL + `/submissions/ResearchGroup`, {
        headers: {
          'Authorization': `Bearer ${localStorage.getItem("AUTOTA_AUTH_TOKEN")}`
        }
      })
      .then(res => {
        setResearchGroup(res.data);
        console.log(res.data);
      })
      .catch(err => {
        console.log(err);
      });
  }, [submissionId, cid]);

  return (
    <div id="code-page">
      <SafeHelmet>
        <title>Submission | TA-Bot</title>
      </SafeHelmet>
      <MenuComponent
        showUpload={false}
        showAdminUpload={false}
        showHelp={true}
        showCreate={false}
        showLast={false}
        showReviewButton={false}
      />
      <Split sizes={[80, 20]} className="split2" direction="vertical">
        <CodeComponent pylintData={pylint} codedata={code} />
        <TestResultsComponent
          codedata={code}
          testcase={json}
          showScore={hasScoreEnabled}
          score={score}
          researchGroup={ResearchGroup}
        />
      </Split>
    </div>
  );
};

export default CodePage;
