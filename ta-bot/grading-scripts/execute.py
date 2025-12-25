#!/usr/bin/python3
import os
import subprocess
import tarfile
import glob
import time
from shutil import copyfile,copytree,rmtree
from typing import Optional
from output import *
from tests import StaticDiffTest
import argparse

TYPE_CONFIG_KEY="TYPE"
DESCRIPTION_CONFIG_KEY="DESCRIPTION"
HIDDEN_CONFIG_KEY="HIDDEN"
TEST_PATH_NAME = "tests"
ERROR_LOG_NAME = "errors.log"
OUTPUT_PATH_NAME = "output"
INPUT_PATH_NAME = "input"
TEMP_PREFIX = "temp-"
TEST_INPUT_EXT = "test"
TEST_SOL_EXT = "sol"
TAR_EXTS = ["tar", "tgz", "tar.gz"]
config_values={"python":["py","3.9.4"],"java":["java","15.0.2"]}
config_list=""

def find_submission(myroot: str, input_path: str, temp_path: str, student_name: str) -> Optional[str]:
    filename = ""
    found = False
    for ext in TAR_EXTS:
        if(os.path.isfile(f"{input_path}.{ext}")):
            filename = f"{input_path}.{ext}"
            tar = tarfile.open(filename)
            tar.extractall()
            tar.close()
            found = True
            break

    if not found:
        for file in glob.glob1(os.path.join(myroot, INPUT_PATH_NAME), student_name+"*"):
            filename = file
            break
        if filename == "":
            print(f"ERROR: No submission found for {student_name}")
            return None
        else:
            filename = os.path.basename(filename)
            pth = os.path.join(myroot, INPUT_PATH_NAME, filename)
            copyfile(pth, os.path.join(temp_path, filename))
    
    files = len(glob.glob1(temp_path, "*.py"))
    if files == 0:
        path = os.listdir(temp_path)
        if not os.path.isdir(path):
            print(f"ERROR: No file found ending in an acceptable extension")
            return None

    return filename

def run(student_name, lang, myroot):
    tic = time.perf_counter()
    suites = []
    output_dir = os.path.join(myroot, OUTPUT_PATH_NAME)
    output_file = os.path.join(output_dir, student_name + ".out")
    temp = TEMP_PREFIX + student_name
    temp_path = os.path.join(myroot, temp)
    input_path = os.path.join(myroot, INPUT_PATH_NAME, student_name)
    test_path = os.path.join(myroot, TEST_PATH_NAME)

    if os.path.isdir(test_path):
        suites = sorted(os.listdir(test_path))
    else:
        print("ERROR: Testcase directory 'tests' not found!")
        return 1
    
    remove_old_files(output_dir, temp_path, student_name)

    filename = find_submission(myroot, input_path, temp_path, student_name)
    if filename == None:
        return 1

    createTapFile(output_file)
    for suite in suites:
        pth=os.path.join(myroot,TEST_PATH_NAME,suite)
        copytree(pth, temp_path, dirs_exist_ok=True)
        tests = sorted(glob.glob1(temp_path, f"*.{TEST_INPUT_EXT}"))
        for test in tests:
            test_sol_file = os.path.join(temp_path, f"{test}.{TEST_SOL_EXT}")
            test_info_file = os.path.join(temp_path, f"{test}.info")
            test_input = os.path.join(temp_path, test)
                
            config_values = {}
            config_values["LANGUAGE"] = "python"
            config_values["VERSION"] = "3.9.4"
            test_conf = parseTestConfig(test_info_file)

            if(test_conf != -1):
                test_conf.update(config_values)

            if int(test_conf[TYPE_CONFIG_KEY]) == 1:
                static_diff = StaticDiffTest(test, suite, test_input, test_conf, test_sol_file, temp_path)
                static_diff.execute_test(os.path.join(temp_path, filename))
                static_diff.write_to_tap(output_file)

        files = glob.glob1(temp_path, f"*.{TEST_INPUT_EXT}") + glob.glob1(temp_path, f"*.{TEST_SOL_EXT}") + glob.glob1(temp_path, "comment")
        for file in files:
            os.remove(os.path.join(temp_path, file))
    end_tap_file(output_file, temp_path)
        
    if lang == "python":
        run_pylint(myroot, output_dir, student_name, filename)

    toc = time.perf_counter()
    print(f"TA-Bot run lasted {toc - tic:0.4f} second(s)")

    return 0

def parseTestConfig(test_path):
    config = {}
    with open(test_path, "r") as test_file:
        for line in test_file:
            m = re.match("([a-zA-Z]+)=(.*)", line)
            if m:
                config[m.group(1)] = m.group(2)
            else:
                return -1
    return config

def remove_old_files(output_dir, temp_path, student_name):
    rmtree(temp_path, ignore_errors=True)
    if os.path.isdir(output_dir):
        files=glob.glob1(output_dir, student_name+"*")
        for file in files:
            os.remove(os.path.join(output_dir, file))
    else:
        os.mkdir(output_dir, 0o770)

    os.mkdir(temp_path, 0o700)

def run_pylint(myroot, output_dir, student_name, filename, language):
    data = subprocess.run(["pylint", os.path.join(myroot, INPUT_PATH_NAME, filename), "--output-format=json"], stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    output = data.stdout
    output=output.decode("utf-8")
    output=output.strip()

    file = open(os.path.join(output_dir, f"{student_name}.out.lint"), "w")
    file.write(output)
    file.close()

def main():
    parser = argparse.ArgumentParser(description='Runs student code against a set of test cases.')
    parser.add_argument('student_name', metavar='StudentName', type=str, help='the name of the student file in the input directory')
    parser.add_argument('language', metavar='Language', type=str, help='the language of the student\'s code')
    parser.add_argument('-r', '--root', default=os.getcwd(), type=str, help='the root of the TA-Bot folder containing input, output, and tests directories.')
    args = parser.parse_args()

    
    return run(args.student_name, args.language, args.root)

if __name__ == "__main__":
    main()