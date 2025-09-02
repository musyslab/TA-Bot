import argparse
import json
import os
import sys
import time
#import git
from pyston import PystonClient,File
import requests
from output import *
from tests import StaticDiffTest
import asyncio
import ast
import subprocess
import tempfile
import re
import CompilerRunner

PISTON_URL ="https://emkc.org/api/v2/piston/execute"
# PISTON_URL ="https://piston.tabot.sh/api/v2/execute"
# PISTON_URL = "https://scarif-dev.cs.mu.edu/piston/v2/execute"


TEMP_PREFIX = "temp-"
OUTPUT_PATH_NAME = "output"



def parse_checkstyle_output(checkstyle_output):
    warnings = []
    for line in checkstyle_output.split('\n'):
        if line.strip():
            # Parse the warning message using regular expressions
            match = re.match(r'^\[(?P<warning_type>\w+)\] (?P<path>.*):(?P<line>\d+):(?P<column>\d+): (?P<message>.*) \[(?P<rule_id>\w+)\]$', line.strip())
            if match:
                warning = {
                    'column': int(match.group('column'))-1,
                    'endColumn': None,
                    'endLine': None,
                    'line': int(match.group('line'))-1,
                    'message': match.group('message'),
                    'message-id': match.group('rule_id'),
                    'module': None,
                    'obj': "",
                    'path': match.group('path'),
                    'reflink': None,
                    'symbol': None,
                    'type': 'convention' # assuming all warnings are of type convention
                }
                warnings.append(warning)
    return json.dumps(warnings, ensure_ascii=False, default=str)

def assess_test(student_output , expected_output):
        with tempfile.NamedTemporaryFile(mode='w', delete=False) as expected_file:
            expected_file.write(expected_output)
            expected_filename = expected_file.name

        with tempfile.NamedTemporaryFile(mode='w', delete=False) as student_file:
            student_file.write(student_output)
            student_filename = student_file.name

        result = subprocess.run(["diff", "-B", "-w", "-i", "-a", "-Z", "-b", "--ignore-trailing-space", expected_filename, student_filename], capture_output=True, text=True)

        subprocess.run(["rm", expected_filename])
        subprocess.run(["rm", student_filename])
        output = result.stdout
        diff_status = result.returncode
        return [output,diff_status]
def write_to_tap(tap_file, result, test_name, test_level,test_description):
    print("In write to tap", flush=True)
    with open(tap_file, "a") as file:
        if result[1] == 0:
            file.write("ok" + "\n")
        else:
            file.write("not ok" + "\n")
        add_yaml(file, test_name, test_level,test_description, result)

def add_output(tap_file, result):
        tap_file.write("    output:\n")
        output = result[0]
        lines = output.strip().split("\n")
        for line in lines:
            line = line.replace("'", "''")
            tap_file.write("      - '" + line + "'\n")


def add_yaml(tap_file, test_name, test_level,test_description, result):
        #TODO: add hidden field, which is currently hardcoded to False
        hidden = False
        tap_file.write("  ---\n")
        tap_file.write("    name: '" + test_name + "'\n")
        tap_file.write("    suite: '" + test_level + "'\n")
        tap_file.write("    type: " + "1" + "\n")
        tap_file.write("    description: '" + test_description + "'\n")
        tap_file.write("    hidden: '" + str(hidden) + "'\n")
        add_output(tap_file, result)
        tap_file.write("  ...\n")

def end_tap_file(output_file, number_of_tests):
    with open(output_file, "a") as file:
        file.write(f"1..{str(number_of_tests)}\n")
    return output_file

def call_piston_api(student_file: str, testcase_in: str, language, additional_file_path: str):
        files = []
        # Build a deterministic file list
        if os.path.isdir(student_file):
            if language == "java":
                java_files = [f for f in os.listdir(student_file) if f.endswith(".java")]
                java_files.sort()  # stable order
                mains = []
                others = []
                for fn in java_files:
                    full = os.path.join(student_file, fn)
                    with open(full, "r", errors="ignore") as fh:
                        src = "".join(line for line in fh if not line.lstrip().startswith("package"))
                    if "public static void main(" in src:
                        mains.append((fn, src))
                    else:
                        others.append((fn, src))
                # Put Main.java first if present, then other mains by filename, then the rest
                mains.sort(key=lambda t: (t[0] != "Main.java", t[0]))
                for fn, src in mains:
                    files.append({"name": os.path.basename(fn), "content": src})
                for fn, src in others:
                    files.append({"name": os.path.basename(fn), "content": src})
            else:
                for fn in sorted(os.listdir(student_file)):
                    full = os.path.join(student_file, fn)
                    if os.path.isfile(full):
                        with open(full, "r", errors="ignore") as fh:
                            files.append({"name": os.path.basename(fn), "content": fh.read()})
        else:
            with open(student_file, "r", errors="ignore") as fh:
                files.append({"name": os.path.basename(student_file), "content": fh.read()})

        if additional_file_path:
            ap = additional_file_path.strip()
            if os.path.isfile(ap):
                with open(ap, "r", errors="ignore") as fh:
                    files.append({"name": os.path.basename(ap), "content": fh.read()})

        payload = {
            "language": language,
            "version": "*",
            "files": files,
            # Some student programs read a line; ensure a trailing newline in stdin.
            "stdin": testcase_in if testcase_in.endswith("\n") else (testcase_in + "\n"),
        }

        # Retry briefly if the API returns empty output (transient)
        for attempt in range(3):
            try:
                resp = requests.post(
                    PISTON_URL,
                    data=json.dumps(payload),
                    headers={"Content-Type": "application/json"},
                    timeout=30
                )
            except Exception:
                time.sleep(0.2 * (attempt + 1))
                continue
            if not resp.ok:
                time.sleep(0.2 * (attempt + 1))
                continue
            try:
                obj = resp.json()
            except ValueError:
                time.sleep(0.2 * (attempt + 1))
                continue
            run_section = obj.get("run", {}) if isinstance(obj, dict) else {}
            stdout = run_section.get("stdout") or ""
            stderr = run_section.get("stderr") or ""
            if stdout:
                return stdout
            if stderr:
                return stderr
            time.sleep(0.2 * (attempt + 1))
        return ""

def execute_test(filename, testcase_in, language, additional_file_path):
        response = call_piston_api(filename, testcase_in.replace('\r', ''), language, additional_file_path)
        if response is None:
            return ""
        return response

def run_liter(myroot, output_dir, student_name, filename, language):
    if language == "python":
        # When a single file is submitted, `filename` is that full path. Use it directly.
        target = filename if not os.path.isdir(filename) else os.path.join(filename, f"{student_name}.py")
        data = subprocess.run(["pylint", target, "--output-format=json"], stdout=subprocess.PIPE, stderr=subprocess.PIPE)

        output = data.stdout
        output=output.decode("utf-8")
        output=output.strip()
        path = os.path.join(output_dir, f"{student_name}.out.lint")
        file = open(os.path.join(output_dir, f"{student_name}.out.lint"), "w")
        file.write(output)
        file.close()
    elif language == "java":
        # Call Checkstyle on the file and save the output to a file
        checkstyle_jar = "/ta-bot/grading-scripts/checkstyle-10.9.2-all.jar"
        config_file = "/ta-bot/grading-scripts/google_checks.xml"
        # `filename` can be a directory (multi-file) or a single Java file
        if not os.path.isdir(filename):
            file = filename
        else:
            files = [fn for fn in os.listdir(filename) if fn.endswith('.java')]
            if "Main.java" in files:
                file = os.path.join(filename, "Main.java")
            else:
                file = os.path.join(filename, files[0])
        data = subprocess.run(["java", "-jar", checkstyle_jar, "-c", config_file, file], stdout=subprocess.PIPE, stderr=subprocess.PIPE)
        output = data.stdout.decode("utf-8")
        output = str(parse_checkstyle_output(output))
        with open(os.path.join(output_dir, f"{student_name}.out.lint"), "w") as file:
            file.write(output)


def admin_run(language, user_input, path, additional_file_path):
    piston_response = execute_test(path, user_input, language, additional_file_path)
    #TODO: Debug why this print statement is needed, if you remove this print statement, the subprocess call doesn't work(returns null value for result.sdout). 
    print(piston_response.replace("\r", "\n"))
    return piston_response.replace("\r", "\n")





def run(student_name, research_group, language, testcases, path, myroot):
    tic = time.perf_counter()
    suites = []
    print("In run", flush=True) 

    # Respect the actual submitted `path`:
    # - if it's a directory (e.g., Java zip extraction), write outputs inside that dir
    # - if it's a file, write outputs next to that file (fallback to myroot if no parent)
    if os.path.isdir(path):
        output_dir = path
    else:
        parent = os.path.dirname(path)
        output_dir = parent if parent else myroot

    output_file = os.path.join(output_dir, student_name + ".out")
    temp = TEMP_PREFIX + student_name
    temp_path = os.path.join(myroot, temp)
    input_path = os.path.join(myroot)
    extension_mapping = {
    "python": "py",
    "java": "java",
    "c++": "cpp",
    "c": "c",
    "javascript": "js",
    "ruby": "rb",
    "php": "php"
    }
    extension = extension_mapping.get(language, "txt")
    if os.path.isdir(path):
        filename = path
    else:
        # Use the real uploaded file path (may include a timestamped filename)
        filename = path  
    createTapFile(output_file)
    testcases = json.loads(testcases)
    for key, value in testcases.items():
        test_name=value[0]
        test_level=value[1]
        test_description=value[2]
        testcase_in = value[3]
        testcase_expected = value[4]
        testcase_additional_file_path = value[6]
        piston_response = execute_test(filename, testcase_in, language, testcase_additional_file_path)
        result = assess_test(piston_response.replace("\r", "\n"), testcase_expected)
        #name suite description
        write_to_tap(output_file, result,test_name, test_level,test_description)
        
    
    end_tap_file(output_file, len(testcases))

    if language == "python": #or language == "java":
        run_liter(myroot, output_dir, student_name, filename, language)
    else:
        path = os.path.join(output_dir, f"{student_name}.out.lint")
        file = open(os.path.join(output_dir, f"{student_name}.out.lint"), "w")
        file.write("")
        file.close()

    return 0


def main():
    parser = argparse.ArgumentParser(description='Runs student code against a set of test cases.')
    parser.add_argument('student_name', metavar='StudentName', type=str, help='the name of the student file in the input directory')
    parser.add_argument('research_group', metavar='ResearchGroup', type=int, help='the number the student is for research')
    parser.add_argument('language', metavar='Language', type=str, help='the language of the student\'s code')
    parser.add_argument('testcase_json', metavar='testcase_json', type=str , help='testcase json input')
    parser.add_argument('paths', metavar='paths', type=str, help='student path files')
    parser.add_argument('additional_file_path', metavar='additional_file_path', type=str, help='additional file path')
    parser.add_argument('project_id', metavar='project_name', type=str, help='name of the current project')
    parser.add_argument('class_id', metavar='class_id_name', type=str, help='name of the current project')
    parser.add_argument('-r', '--root', default=os.getcwd(), type=str, help='the root of the TA-Bot folder containing input, output, and tests directories.')
    args = parser.parse_args()
    args.research_group = int(args.research_group)
    paths = str(args.paths)

    if args.student_name != "ADMIN" and args.research_group != 1:
        return run(args.student_name, args.research_group, args.language, args.testcase_json, args.paths, args.root)

    elif args.research_group == 1 and args.student_name != "ADMIN":
        # Use the same piston-backed runner for RG1 too
        return run(args.student_name, args.research_group, args.language, args.testcase_json, args.paths, args.root)

    elif args.student_name == "ADMIN" and args.research_group == 1:
        # Use piston-backed admin path instead of CompilerRunner.admin_run
        return admin_run(args.language, args.testcase_json, args.paths, args.additional_file_path)

    else:
        # admin non-RG1
        return admin_run(args.language, args.testcase_json, args.paths, args.additional_file_path)

if __name__ == "__main__":
    main()
    