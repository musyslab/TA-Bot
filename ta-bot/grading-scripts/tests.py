from abc import ABC, abstractmethod
from typing import Dict, Optional
import json
import requests
import subprocess
import os

TYPE_CONFIG_KEY="TYPE"
DESCRIPTION_CONFIG_KEY="DESCRIPTION"
HIDDEN_CONFIG_KEY="HIDDEN"
SERVER_URL = "https://piston.tabot.sh/api/v2/execute"
#SERVER_URL="https://emkc.org/api/v2/piston/execute"

class PistonApiReponse():
    def __init__(self, stdout, stderror, output, code, signal):
        self._stdout = stdout
        self._stderror = stderror
        self._output = output
        self._code = code
        self._signal = signal

    @property
    def stdout(self):
        return self._stdout
    @property
    def stderror(self):
        return self._stderror
    @property
    def output(self):
        return self._output
    @property
    def code(self):
        return self._code
    @property
    def signal(self):
        return self._signal

class Test(ABC):

    @property
    @abstractmethod
    def name(self) -> str:
        pass

    @property
    @abstractmethod
    def suite(self) -> str:
        pass

    @property
    @abstractmethod
    def output(self) -> str:
        pass

    @property
    @abstractmethod
    def input(self) -> str:
        pass

    @abstractmethod
    def execute_test(self, student_file: str):
        pass

    @abstractmethod
    def assess_test(research_group, self):
        pass

    @abstractmethod
    def write_to_tap(self, tap_file):
        pass

    @staticmethod
    def call_piston_api(student_file: str, config: Dict[str, str], test_in: str) -> Optional[PistonApiReponse]:
        input_file_contents = ""
        student_code = ""
        results = {}
        files = []

        with open(test_in,"r") as file:
            input_file_contents = file.read()
        
        with open(student_file) as file:
            student_code = file.read()
        files.append({ "name": os.path.basename(student_file), "content": student_code })

        if "NONCODEFILES" in config:
            noncode_files = config["NONCODEFILES"].split(",")
            for file in noncode_files:
                with open(file) as f:
                    file_info = f.read()
                    files.append({ "name": os.path.basename(file), "content": file_info })

        results["language"] = config["LANGUAGE"]
        results["version"] = config["VERSION"]
        results["files"] = files
        results["stdin"] = input_file_contents

        response = requests.post(SERVER_URL, data=json.dumps(results), headers={ "Content-Type": "application/json" })

        if(response.ok):
            output_obj = response.json()
            output = PistonApiReponse(output_obj["run"]["stdout"], output_obj["run"]["stderr"], output_obj["run"]["output"], output_obj["run"]["code"], output_obj["run"]["signal"])
            return output
        return None
    
    def add_yaml(self, tap_file):
        hidden = False
        if HIDDEN_CONFIG_KEY in self.config:
            hidden = self.config[HIDDEN_CONFIG_KEY]

        tap_file.write("  ---\n")
        tap_file.write("    name: '" + self.name + "'\n")
        tap_file.write("    suite: '" + self.suite + "'\n")
        tap_file.write("    type: " + self.config[TYPE_CONFIG_KEY] + "\n")
        tap_file.write("    description: '" + self.config[DESCRIPTION_CONFIG_KEY] + "'\n")
        tap_file.write("    hidden: '" + str(hidden) + "'\n")
        self.add_output(tap_file)
        tap_file.write("  ...\n")

    def add_output(self, tap_file):
        tap_file.write("    output:\n")
        lines = self.output.strip().split("\n")
        for line in lines:
            line = line.replace("'", "''")
            tap_file.write("      - '" + line + "'\n")
                

class StaticDiffTest(Test):

    def __init__(self, name, suite, input, config, expected_output: str, temp_dir: str):
        self._name = name
        self._suite = suite
        self._input = input
        self._config = config

        self._output = ""
        self._diff_status = 0

        self.temp_dir = temp_dir
        self.expected_output = expected_output

    @property
    def output(self):
        return self._output
          
    @output.setter
    def output(self, value):
        self._output = value

    @property
    def name(self):
        return self._name

    @property
    def suite(self):
        return self._suite

    @property
    def input(self):
        return self._input

    @property
    def config(self):
        return self._config

    def execute_test(self, student_file: str):
        response = self.call_piston_api(student_file, self.config, self.input)
        if response == None:
            self.output = "ERROR: API returned non-200 response"
        else:
            self.output = response.output

    def assess_test(self, research_group):
        student_output = os.path.join(self.temp_dir, "output.txt")
        print(research_group)
        with open(student_output, "w") as file:
            file.write(self.output)
        if(research_group==0):
            result = subprocess.run(["diff", "-B", "-w", "-i", "-a", self.expected_output, student_output], capture_output=True, text=True)
            os.remove(student_output)
            self.output = result.stdout
            self._diff_status = result.returncode
        elif(research_group == 1 or research_group == 2):
            result = subprocess.run(["diff", "-B", "-w", "-i", "-a", self.expected_output, student_output], capture_output=True, text=True)
            with open(self.expected_output, 'r') as f:
                expected=f.read()
            self.output = self.output + "\n~~~diff~~~\n" + expected
            os.remove(student_output)
            self._diff_status = result.returncode


    def write_to_tap(self, tap_file):
        with open(tap_file, "a") as file:
            if self._diff_status == 0:
                file.write("ok" + "\n")
            else:
                file.write("not ok" + "\n")
            self.add_yaml(file)

class NondeterministicTest(Test):

    def __init__(self, name, suite, input, config):
        self._name = name
        self._suite = suite
        self._input = input
        self._config = config
        self._output = ""

    @property
    def output(self):
        return self._output
          
    @output.setter
    def output(self, value):
        self._output = value

    @property
    def name(self):
        return self._name

    @property
    def suite(self):
        return self._suite

    @property
    def input(self):
        return self._input

    @property
    def config(self):
        return self._config

    def execute_test(self, student_file: str):
        response = self.call_piston_api(student_file, self.config, self.input)
        if response == None:
            self.output = "ERROR: API returned non-200 response"
        else:
            self.output = response.output

    def assess_test(assess_test, self):
        pass

    def write_to_tap(self, tap_file):
        with open(tap_file, "a") as file:
            file.write("ok" + "\n")
            self.add_yaml(file)
