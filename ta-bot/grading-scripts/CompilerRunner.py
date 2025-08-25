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
import tempfile
import re
import json
import paramiko
from scp import SCPClient


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

def test_bed_setup(project_name, file_path):
     if project_name == "straight_line":
        temp_path = "/ta-bot/compiler_testbed/straight_line/Interpreter.java"
        copyfile(file_path, temp_path)       

def runner(testcase_in, file_path, project_name):
    if project_name == "straight_line":
        temp_path = "/ta-bot/compiler_testbed/straight_line/Interpreter.java"

        with open(temp_path, "w") as file:
            with open(file_path, "r") as file_in:
                file.write(file_in.read())



        # remove old Program.java, write to it using testcase_in
        program_path = "/ta-bot/compiler_testbed/straight_line/Program.java"
        with open(program_path, "w") as file:
            file.write(testcase_in)
        
        # Compile the Students Java File that now resides in the testbed
        compile_command = f"javac -cp /ta-bot/compiler_testbed/straight_line/ {temp_path}"
        try:
            result = subprocess.run(compile_command, shell=True, check=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
        except subprocess.CalledProcessError as e:
            print(e.stdout, flush=True)
            print(e.stderr, flush=True)
            return

        # check if the compile was successful
        class_file = "/ta-bot/compiler_testbed/straight_line/Interpreter.class"
        if os.path.exists(class_file):
            # Run the students Java File and Capture the output
            run_command = f"java -cp /ta-bot/compiler_testbed/straight_line Interpreter"
            result = subprocess.run(run_command, shell=True, capture_output=True, text=True)
            print(result.stdout, flush=True)
            return result.stdout
        else:
            return False
    else:
        return False
     
def admin_run(testcase_in, file_path, project_name):
    test_bed_setup(project_name, file_path)
    return runner(testcase_in, file_path, project_name)


def run(student_name, language, testcases, path, myroot, project_id, class_id):
    print("Running tests for  Compiler Runner: " + student_name)
   
    if os.path.isdir(path):
        output_dir = os.path.join(path)
        output_file = os.path.join(output_dir, student_name + ".out")
    else:
        output_dir = os.path.join(myroot)
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
    "php": "php",
    "zip": "zip",
    "tgz": "tgz",
    }
    extension = extension_mapping.get(language, "txt")
    print("path in runnner: " + path, flush=True)
    createTapFile(output_file)

    print("FilePath: " + path, flush=True)

    # Define your credentials and paths
    remote_host = "morbius.mscsnet.mu.edu"
    remote_user = "tabot"
    remote_path = "/users/personnel/tabot/cosc4400/grading/grading-tabot-scanner-standing/input" 
    local_path = path # Replace with the actual local file path

    # Extract the filename from the local path
    filename = os.path.basename(local_path)

    # Initialize the SSH client
    ssh = paramiko.SSHClient()
    ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())

    
    ssh.connect(remote_host, username=remote_user, key_filename='../id_rsa')

    # Use SCPClient to transfer the file to the remote server
    with SCPClient(ssh.get_transport()) as scp:
        scp.put(local_path, os.path.join(remote_path, filename))
        
    api_line = "http://tabot.sh:8009/api/upload/remote-upload"
    command_to_execute = f"cd /users/personnel/tabot/cosc4400/grading/grading-tabot-scanner-standing; ./grade.sh {student_name} {project_id} {class_id} {api_line}  > /dev/null 2>&1 &"

    # Execute the command on the remote server
    stdin, stdout, stderr = ssh.exec_command(command_to_execute)

    # Wait for the command to complete
    #exit_status = stdout.channel.recv_exit_status()

    # # Print the command output
    # print("Grading STDOUT:")
    # for line in stdout:
    #     print(line.strip())

    # print("Grading STDERR:")
    # for line in stderr:
    #     print(line.strip())

    # # Check the exit status
    # if exit_status == 0:
    #     print("Command executed successfully")
    # else:
    #     print(f"Command failed with exit status {exit_status}")

    # Close the SSH connection
    ssh.close()


    
    end_tap_file("API CALLER TODO", len(testcases))

    




    return 0


