#!/bin/bash

# Script has three modes:
# --final mails student and CCs instructors.
# --nightly mails just student.
# default mails the login running the script.

TABOTMSGNIGHTLY="mailbot-message-nightly.txt"
TABOTMSGFINAL="mailbot-message-final.txt"
TABOTTAG="TA-BOT:MAILTO"
LOOKUP=/users/home/agebhard/ta-bot/lookup.sh
MYNAME=`/usr/bin/whoami`
HOSTNAME=`/bin/hostname`
DOMNAME=`/bin/hostname -d`
STAGEDIR=mail-`date +%s`
BOUNDARY="vkogqOf2sHV7VnPd"
INSTRUCTORS="alexander.gebhard@marquette.edu"

if [ -z "${MYNAME}" ]; then
	MYNAME=agebhard
fi

# MYADDR=`${LOOKUP} ${MYNAME}`
MYADDR="ta-bot@cs.mu.edu"

if [ -z "${HOSTNAME}" ]; then
        HOSTNAME=localhost
fi

if [ -z "${DOMNAME}" ]; then
        DOMNAME=localdomain
fi


echo "=======================" >> maillog.txt
echo "= Starting TA-bot run =" >> maillog.txt
echo "=======================" >> maillog.txt
date >> maillog.txt

mkdir ${STAGEDIR}

if [ $# -eq 2 ]; then
	INFILES=`ls ${2}`
else
	INFILES=`ls *.out`
fi

for i in ${INFILES}; do 
	USERNAME=`basename $i .out`
	FILENAME=${USERNAME}.txt
	echo -n "${USERNAME}: "
	echo "" >> ${STAGEDIR}/${FILENAME}
	echo "" >> ${STAGEDIR}/${FILENAME}
	echo "--${BOUNDARY}" >> ${STAGEDIR}/${FILENAME}
	echo "Content-Type: text/plain; charset=us-ascii" >> ${STAGEDIR}/${FILENAME}
	echo "Content-Disposition: inline" >> ${STAGEDIR}/${FILENAME}
	echo "" >> ${STAGEDIR}/${FILENAME}
	echo "" >> ${STAGEDIR}/${FILENAME}

	if [ $# -ge 1 -a "$1" = "--final" ]; then
		cat ${TABOTMSGFINAL} >> ${STAGEDIR}/${FILENAME}
	else
		cat ${TABOTMSGNIGHTLY} >> ${STAGEDIR}/${FILENAME}
	fi

	echo "" >> ${STAGEDIR}/${FILENAME}
        echo "" >> ${STAGEDIR}/${FILENAME}
        echo "--${BOUNDARY}" >> ${STAGEDIR}/${FILENAME}
        echo "Content-Type: text/plain; charset=utf-8" >> ${STAGEDIR}/${FILENAME}
        echo "Content-Disposition: inline" >> ${STAGEDIR}/${FILENAME}
        echo "Content-Transfer-Encoding: 8bit" >> ${STAGEDIR}/${FILENAME}
        echo "" >> ${STAGEDIR}/${FILENAME}
        echo "" >> ${STAGEDIR}/${FILENAME}


	cat $i | egrep -a -v '^\.$' >> ${STAGEDIR}/${FILENAME}

        echo "" >> ${STAGEDIR}/${FILENAME}
        echo "--${BOUNDARY}--" >> ${STAGEDIR}/${FILENAME}

	LINES=`cat ${STAGEDIR}/${FILENAME} | wc -l`
	BYTES=`cat ${STAGEDIR}/${FILENAME} | wc -c`
	
	# Scan input file for TA-Bot MAILTO command.
	ADDRESSES=`grep -i ${TABOTTAG} ${i} | \
		  gawk -v RS='[[:alnum:]_\x2E\x2D]+@[[:alnum:]_\x2E\x2D]+[[:alnum:]]+' 'RT{print RT}' | sort | uniq`

	# If no addresses found, default to login name.
	if [ -z "${ADDRESSES}" ]; then
		ADDRESSES=`${LOOKUP} ${USERNAME}`
	fi

	# Based on run type, append or replace destination addresses and subj.
	if [ $# -ge 1 -a "$1" = "--final" ]; then
		ADDRESSES="${ADDRESSES} ${INSTRUCTORS}"
		SUBJECT="TA-bot final results"
	elif [ $# -ge 1 -a "$1" = "--nightly" ]; then
		SUBJECT="TA-bot nightly results"
	else
		ADDRESSES="${MYADDR}"
		SUBJECT="TA-bot testrun (not mailed to students)"
	fi


	echo "HELO ${HOSTNAME}" > mail.txt
	echo "MAIL From: ${MYADDR}" >> mail.txt
	for ADDRESS in ${ADDRESSES}; do
		echo "RCPT To: ${ADDRESS}" >> mail.txt
		echo -n "${ADDRESS} "
		done
	echo "DATA" >> mail.txt

	echo -n "To: " >> mail.txt
	echo ${ADDRESSES} | \
	awk '{ 
		for (i=1; i<NF; i++) 
			printf $i ", " 
		print $NF
		}' >> mail.txt
	echo "Subject: ${SUBJECT}" >> mail.txt
	echo "MIME-Version: 1.0" >> mail.txt
	echo "Content-Type: multipart/mixed; boundary=\"${BOUNDARY}\"" >> mail.txt
	echo "Content-Disposition: inline" >> mail.txt
	echo "Content-Transfer-Encoding: 8bit" >> mail.txt
	echo "Status: RO" >> mail.txt
	echo "Content-Length: ${BYTES}" >> mail.txt
	echo "Lines: ${LINES}" >> mail.txt

	cat ${STAGEDIR}/${FILENAME} >> mail.txt

	echo "." >> mail.txt
	echo "QUIT" >> mail.txt

	cat mail.txt | nc localhost 25 >> maillog.txt
	echo ""
	done

rm -Rf ${STAGEDIR}
