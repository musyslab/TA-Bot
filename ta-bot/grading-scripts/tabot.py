import argparse
import json
import os
import sys
import time
#import git
from pyston import PystonClient,File
import requests
from output import *
import asyncio
import ast
import subprocess
import tempfile
import re
import CompilerRunner
from typing import List, Tuple

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
def write_to_tap(tap_file, result, test_name ,test_description, hidden=False):
    print("In write to tap", flush=True)
    with open(tap_file, "a") as file:
        if result[1] == 0:
            file.write("ok" + "\n")
        else:
            file.write("not ok" + "\n")
        add_yaml(file, test_name, test_description, result, hidden=hidden)

def add_output(tap_file, result):
        tap_file.write("    output:\n")
        output = result[0]
        lines = output.strip().split("\n")
        for line in lines:
            line = line.replace("'", "''")
            tap_file.write("      - '" + line + "'\n")

def yaml_sq(s):
        """
        Safe single-quoted YAML scalar:
        - doubles single quotes
        - converts real newlines into literal \\n so YAML stays one-line
        """
        if s is None:
            return ""
        s = str(s).replace("'", "''")
        s = s.replace("\r\n", "\n").replace("\r", "\n")
        s = s.replace("\n", "\\n")
        return s            

def add_yaml(tap_file, test_name ,test_description, result, hidden=False):
        tap_file.write("  ---\n")
        tap_file.write("    name: '" + yaml_sq(test_name) + "'\n")
        tap_file.write("    type: " + "1" + "\n")
        tap_file.write("    description: '" + yaml_sq(test_description) + "'\n")
        tap_file.write("    hidden: '" + yaml_sq(str(hidden)) + "'\n")
        add_output(tap_file, result)
        tap_file.write("  ...\n")

def end_tap_file(output_file, number_of_tests):
    with open(output_file, "a") as file:
        file.write(f"1..{str(number_of_tests)}\n")
    return output_file

def call_piston_api(student_file: str, testcase_in: str, language, additional_files):
        files = []

        def _strip_java_package(src: str) -> str:
            return "".join(line for line in src.splitlines(True) if not line.lstrip().startswith("package"))

        def _extract_main_class_name(src: str) -> str:
            # Find a class that contains a main method
            if "public static void main(" not in src:
                return ""
            # Heuristic: first "class X" in the file
            m = re.search(r'\bclass\s+([A-Za-z_]\w*)\b', src)
            return m.group(1) if m else ""

        def _demote_public_types(src: str) -> str:
            # Demote only top-level public type declarations (line-start)
            src = re.sub(r'^\s*public\s+(class|interface|enum)\s+', r'\1 ', src, flags=re.M)
            return src

        def _bundle_java_into_main(java_sources: List[Tuple[str, str]]) -> str:
            """
            Bundle multiple Java files into a single Main.java:
              - strip package lines
              - hoist imports
              - demote public top-level types
              - add public class Main wrapper that calls the detected main class
            """
            imports = set()
            bodies: List[str] = []
            main_class = ""

            for (name, raw) in java_sources:
                src = _strip_java_package(raw)
                # collect imports and remove them from body
                kept_lines = []
                for line in src.splitlines():
                    if line.lstrip().startswith("import "):
                        imports.add(line.strip())
                    else:
                        kept_lines.append(line)
                body = "\n".join(kept_lines).strip()
                # detect main class (first file that has main)
                if not main_class:
                    mc = _extract_main_class_name(body)
                    if mc:
                        main_class = mc
                bodies.append(body)

            if not main_class:
                # fallback: try to pick the first class name
                m = re.search(r'\bclass\s+([A-Za-z_]\w*)\b', "\n".join(bodies))
                main_class = m.group(1) if m else "Main"

            # demote all public types so we can have exactly one public class (Main)
            bodies = [_demote_public_types(b) for b in bodies if b]

            import_block = "\n".join(sorted(imports)).strip()

            if main_class == "Main":
                # If the student's entry class is already Main, do not wrap.
                # Just ensure imports are at top and keep only one public Main.
                # (We demoted publics above; restore 'public class Main' if present.)
                joined = "\n\n".join(bodies)
                joined = re.sub(r'^\s*class\s+Main\b', 'public class Main', joined, flags=re.M)
                if import_block:
                    return import_block + "\n\n" + joined + "\n"
                return joined + "\n"

            wrapper = (
                "public class Main {\n"
                "  public static void main(String[] args) throws Exception {\n"
                f"    {main_class}.main(args);\n"
                "  }\n"
                "}\n"
            )

            if import_block:
                return import_block + "\n\n" + wrapper + "\n" + "\n\n".join(bodies) + "\n"
            return wrapper + "\n" + "\n\n".join(bodies) + "\n"


        def normalize_double_ext(name: str) -> str:
            # Guard against accidental "Foo.java.java"
            if not name:
                return name
            low = name.lower()
            if low.endswith(".java.java"):
                return name[:-5]  # drop last ".java"
            if low.endswith(".py.py"):
                return name[:-3]
            if low.endswith(".c.c"):
                return name[:-2]
            if low.endswith(".rkt.rkt"):
                return name[:-4]
            return name

        if os.path.isdir(student_file):
            if language == "java":
                # Piston java runtime often compiles only a single entry file.
                # Bundle all .java files into Main.java so dependencies resolve.
                java_sources: List[Tuple[str, str]] = []
                for fn in sorted(os.listdir(student_file)):
                    if fn.endswith(".java"):
                        full = os.path.join(student_file, fn)
                        if os.path.isfile(full):
                            with open(full, "r", errors="ignore") as fh:
                                java_sources.append((fn, fh.read()))
                # include additional java files too (if any)
                extras = []
                if additional_files:
                    try:
                        if isinstance(additional_files, str):
                            s = additional_files.strip()
                            extras = json.loads(s) if s.startswith('[') else ([s] if s else [])
                        else:
                            extras = list(additional_files)
                    except Exception:
                        extras = []
                for ap in extras:
                    ap = (ap or "").strip()
                    if os.path.isfile(ap) and ap.endswith(".java"):
                        with open(ap, "r", errors="ignore") as fh:
                            java_sources.append((os.path.basename(ap), fh.read()))
                bundled = _bundle_java_into_main(java_sources)
                files.append({"name": "Main.java", "content": bundled})
            else:
                for root, _, fns in os.walk(student_file):
                    for fn in sorted(fns):
                        full = os.path.join(root, fn)
                        if os.path.isfile(full):
                            with open(full, "r", errors="ignore") as fh:
                                files.append({"name": normalize_double_ext(os.path.basename(fn)), "content": fh.read()})
        else:
            with open(student_file, "r", errors="ignore") as fh:
                if language == "java":
                    # Single-file java can still depend on additional java files.
                    # Bundle into Main.java (wrapper) for consistent compilation.
                    base_src = fh.read()
                    java_sources: List[Tuple[str, str]] = [(os.path.basename(student_file), base_src)]
                    extras = []
                    if additional_files:
                        try:
                            if isinstance(additional_files, str):
                                s = additional_files.strip()
                                extras = json.loads(s) if s.startswith('[') else ([s] if s else [])
                            else:
                                extras = list(additional_files)
                        except Exception:
                            extras = []
                    for ap in extras:
                        ap = (ap or "").strip()
                        if os.path.isfile(ap) and ap.endswith(".java"):
                            with open(ap, "r", errors="ignore") as efh:
                                java_sources.append((os.path.basename(ap), efh.read()))
                    bundled = _bundle_java_into_main(java_sources)
                    files.append({"name": "Main.java", "content": bundled})
                else:
                    files.append({"name": os.path.basename(student_file), "content": fh.read()})

        # Append additional files for ALL languages.
        # For Java, we already bundled any .java extras into Main.java above, so skip .java here.

            extras = []
            if additional_files:
                try:
                    if isinstance(additional_files, str):
                        s = additional_files.strip()
                        extras = json.loads(s) if s.startswith('[') else ([s] if s else [])
                    else:
                        extras = list(additional_files)
                except Exception:
                    extras = []
            for ap in extras:
                ap = (ap or "").strip()
                if os.path.isfile(ap):
                    bn = os.path.basename(ap)
                    if language == "java" and bn.lower().endswith(".java"):
                        continue
                    if not any(f.get("name") == bn for f in files):
                        with open(ap, "r", errors="ignore") as fh:
                            files.append({"name": bn, "content": fh.read()})

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

def execute_test(filename, testcase_in, language, additional_files):
        response = call_piston_api(filename, testcase_in.replace('\r', ''), language, additional_files)
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


def admin_run(language, user_input, path, additional_files):
    piston_response = execute_test(path, user_input, language, additional_files)
    #TODO: Debug why this print statement is needed, if you remove this print statement, the subprocess call doesn't work(returns null value for result.sdout). 
    print(piston_response.replace("\r", "\n"))
    return piston_response.replace("\r", "\n")





def run(student_name, language, testcases, path, myroot):
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
        test_name = value[0]
        test_description = value[1] if len(value) > 1 else ""       
        testcase_in = value[2]
        testcase_expected = value[3]
        hidden = value[4] if len(value) > 4 else False
        testcase_additional_files = value[5]
        piston_response = execute_test(filename, testcase_in, language, testcase_additional_files)
        result = assess_test(piston_response.replace("\r", "\n"), testcase_expected)
        #name suite description
        write_to_tap(output_file, result, test_name, test_description, hidden)
        
    
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
    if len(sys.argv) >= 8 and sys.argv[1] == "ADMIN":
        # argv layout:
        #   tabot.py ADMIN <language> <testcase_json...> <paths> <additional_file_path> <project_id> <class_id>
        language = sys.argv[2]
        paths = sys.argv[-4]
        additional_file_path = sys.argv[-3]
        testcase_json = " ".join(sys.argv[3:-4])
        return admin_run(language, testcase_json, paths, additional_file_path)

    parser = argparse.ArgumentParser(description='Runs student code against a set of test cases.')
    parser.add_argument('student_name', metavar='StudentName', type=str, help='the name of the student file in the input directory')
    parser.add_argument('language', metavar='Language', type=str, help='the language of the student\'s code')
    parser.add_argument('testcase_json', metavar='testcase_json', type=str , help='testcase json input')
    parser.add_argument('paths', metavar='paths', type=str, help='student path files')
    parser.add_argument('additional_file_path', metavar='additional_file_path', type=str, help='additional file path')
    parser.add_argument('project_id', metavar='project_name', type=str, help='name of the current project')
    parser.add_argument('class_id', metavar='class_id_name', type=str, help='name of the current project')
    parser.add_argument('-r', '--root', default=os.getcwd(), type=str, help='the root of the TA-Bot folder containing input, output, and tests directories.')
    args = parser.parse_args()
    paths = str(args.paths)

    if args.student_name == "ADMIN":
        # Admin path uses piston-backed runner
        return admin_run(args.language, args.testcase_json, args.paths, args.additional_file_path)
 
    # Normal student path
    return run(args.student_name, args.language, args.testcase_json, args.paths, args.root)

if __name__ == "__main__":
    main()
    