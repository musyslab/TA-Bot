#!/bin/sh

# project-deadline.sh
# DWB 2009
#
# This script is intended to be run on a nightly basis to open and close
#  electronic submission ("turnin") boxes at scheduled times.  The normal
#  usage is to create a crontab entry such as below on Morbius:
#
#  0 0 * * *	/users/faculty/brylow/submit3410/project-deadline.sh /users/faculty/brylow/submit3410/deadlines
#
# This crontab entry would re-process the deadlines file every day at
#  midnight, setting up 'at' entries to automatically open or close the
#  submissions at specified times.


DATE=`date +"%F"`
PROJECT=/usr/local/bin/project
AWK=/bin/awk
AT=/usr/bin/at

if [ $# -ne 1 ]; then
	echo "Usage: project-deadlines.sh <deadline-file>"
	exit 1;
fi

if [ ! -e $1 ]; then
	echo "Could not read deadline file, \"$1\""
	exit 1;
fi

LINES=`wc -l $1 | awk '{print $1}'`

for i in `seq ${LINES}`; do
	LINE=`head -${i} $1 | tail -1`
	CURDATE=`echo ${LINE} | awk '{print $1}'`
	CURTIME=`echo ${LINE} | awk '{print $2}'`
	CURCLSS=`echo ${LINE} | awk '{print $3}'`
	CURPROJ=`echo ${LINE} | awk '{print $4}'`
	CURACTN=`echo ${LINE} | awk '{print $5}'`

	if [ "${DATE}" = "${CURDATE}" ]; then
		if [ "${CURACTN}" = "enable" ]; then
			echo "${PROJECT} -c ${CURCLSS} -e ${CURPROJ}"	\
				| ${AT} ${CURTIME} today
		fi

		if [ "${CURACTN}" = "disable" ]; then
			echo "${PROJECT} -c ${CURCLSS} -d ${CURPROJ}"	\
				| ${AT} ${CURTIME} today
		fi
	fi
done
