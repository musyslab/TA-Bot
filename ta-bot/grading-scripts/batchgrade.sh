#!/bin/bash
# @author Dr. Dennis Brylow
#
# Grade student tarball on a specific backend.
# This is only used in 'rungrades.sh' and should never be
# explicitly ran by the TA.
#
# Used for Assignments 3 thru 10.

if [ $# -lt 1 ]; then
  echo "Usage: batchgrade.sh <Backend> <StudentNames>"
  exit 1;
fi

BACKEND=$1
shift 1
echo "Grading $* on ${BACKEND}"

# Run the grade script on every other parameter (Student name)
for i in $*; do
	./grade.sh `basename $i .tgz` ${BACKEND}
done
