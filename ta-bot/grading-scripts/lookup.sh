#!/bin/sh

if [ $# -eq 1 ]; then
	USER=$1
else
	USER=`whoami`
fi
CN=`getent passwd mscsnet.mu.edu\\\\${USER} | awk -F: '{print $5}'`

if [ -z "${CN}" ]; then
	echo "No_account_${USER}"
	exit -1;
fi

POSSIBLE_OUS="OU=Faculty
	OU=MISC,OU=Students
	OU=BIEN-MS,OU=GRAD,OU=Students
	OU=BIEN-PHD,OU=GRAD,OU=Students
	OU=BIIN-MS,OU=GRAD,OU=Students
	OU=COMP-MS,OU=GRAD,OU=Students
	OU=COMP-MS-O,OU=GRAD,OU=Students
	OU=COMP-PHP,OU=GRAD,OU=Students
	OU=EECE-MS,OU=GRAD,OU=Students
	OU=EECE-PHD,OU=GRAD,OU=Students
	OU=COEN-MINOR,OU=UGRD,OU=Students
	OU=COMA-BS,OU=UGRD,OU=Students
	OU=COMA-MAJ2,OU=UGRD,OU=Students
	OU=COSC-BS,OU=UGRD,OU=Students
	OU=COSC-MAJ2,OU=UGRD,OU=Students
	OU=COSC-MINOR,OU=UGRD,OU=Students
	OU=MATH-BS,OU=UGRD,OU=Students
	OU=MATH-MAJ2,OU=UGRD,OU=Students
	OU=MATH-MINOR,OU=UGRD,OU=Students
	OU=Guests
	"

RESULT=""

for unit in ${POSSIBLE_OUS}
do
#	echo "Query for ${CN} in ${unit}"
	QUERY=`ldapsearch -LLL -x -h directory.mscsnet.mu.edu -D "tabot@mscsnet.mu.edu" -y /users/personnel/brylow/os/grading/.ldap -b "CN=${CN},${unit},OU=Users,OU=MSCSNET,DC=mscsnet,DC=mu,DC=edu" mail 2>/dev/null`
	if [ $? -eq 0 ]; then
		RESULT="${QUERY}"
		break;
	fi
done

RESULT=`echo "${RESULT}" | grep mail`
RESULT=`echo "${RESULT}" | awk '{print $NF}'`
if [ -n "${RESULT}" ]; then
	echo "${RESULT}"
else
	# Can't find it anywhere.  Guess First.Last@marquette.edu
	echo -n "${CN}" | tr [:space:] "."
	echo "@marquette.edu"
fi
