import { useEffect, useState } from 'react'
import codeimg from '../codeex.png'
import axios from 'axios'
import styles from '../css/ClassSelectionPageComponent.module.scss'

interface DropDownOption {
  key: number;
  value: number;
  text: string;
}

var Coptions = Array<DropDownOption>();
var LectureOptions = Array<DropDownOption>();
var Loptions = Array<DropDownOption>();

const ClassSelectionPageComponent = () => {
  const [studentClassNames, setstudentClassNames] = useState<Array<string>>([]);
  const [studentClassNumbers, setstudentClassNumbers] = useState<Array<string>>([]);
  const [addClass, setaddClass] = useState<boolean>(false);
  const [ClassId, setClassId] = useState<String>('');
  const [LectureId, setLectureId] = useState<String>('');
  const [LabId, setLabId] = useState<String>('');

  const handleClassSubmit = () => {
    const formData = new FormData();
    formData.append('class_name', ClassId.toString());
    formData.append('lecture_name', LectureId.toString());
    formData.append('lab_name', LabId.toString());
    axios
      .post(import.meta.env.VITE_API_URL + `/class/add_class_student`, formData, {
        headers: {
          Authorization: `Bearer ${localStorage.getItem('AUTOTA_AUTH_TOKEN')}`,
        },
      })
      .then(() => {
        window.location.href = 'code';
      })
      .catch(() => {
        window.alert('Invalid entry');
        window.location.href = '/class/classes';
      });
  };

  const handleClassIdChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const value = event.target.value;
    setClassId(value);
  };
  const handleLectureIdChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const value = event.target.value;
    setLectureId(value);
  };
  const handleLabIdChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const value = event.target.value;
    setLabId(value);
  };

  useEffect(() => {
    axios
      .get(import.meta.env.VITE_API_URL + `/class/all?filter=true`, {
        headers: {
          Authorization: `Bearer ${localStorage.getItem('AUTOTA_AUTH_TOKEN')}`,
        },
      })
      .then((res) => {
        setstudentClassNames([]);
        setstudentClassNumbers([]);
        res.data.map((obj: { id: number; name: string }) => {
          setstudentClassNumbers((oldArray) => [...oldArray, obj.id + '']);
          setstudentClassNames((oldArray) => [...oldArray, obj.name]);
        });
      });
  }, []);

  return (
    <div className={styles.container}>
      <div className={styles.sectionTitle}>Student Classes</div>

      <div className={styles.classList}>
        {studentClassNames.map((name, index) => (
          <a
            key={index}
            href={`/class/${studentClassNumbers[index]}/upload`}
            className={styles.clickableRow}
          >
            <div>
              <img src={codeimg} alt="Code" />
            </div>
            <div>
              <h1 className={styles.title}>{name}</h1>
            </div>
          </a>
        ))}
      </div>

      {addClass && (
        <form>
          <div>
            <label htmlFor="className">Class Name</label>
            <input
              id="className"
              placeholder="COSC 1020"
              value={ClassId as string}
              onChange={handleClassIdChange}
            />
          </div>

          <div>
            <label htmlFor="lectureNumber">Lecture Number</label>
            <input
              id="lectureNumber"
              placeholder="102"
              value={LectureId as string}
              onChange={handleLectureIdChange}
            />
          </div>

          <div>
            <label htmlFor="labNumber">Lab Number</label>
            <input
              id="labNumber"
              placeholder="405"
              value={LabId as string}
              onChange={handleLabIdChange}
            />
          </div>

          <button type="submit" onClick={handleClassSubmit}>
            Submit
          </button>
        </form>
      )}
    </div>
  );

};

export default ClassSelectionPageComponent;
