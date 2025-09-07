import datetime
import re
from operator import and_
from typing import Dict, List

from sqlalchemy import asc, desc

from src.repositories.database import db
from .models import ClassAssignments, LectureSections, Users, LoginAttempts, Labs
from flask_jwt_extended import current_user


class UserRepository():

    def get_user_status(self) -> str:
        return str(current_user.Role)

    def getUserByName(self, username: str) -> Users:
        """
        Returns a user object from the database based on the given username.
        
        Args:
        - username (str): the username of the user to retrieve
        
        Returns:
        - Users: the user object corresponding to the given username, or None if no such user exists
        """
        user = Users.query.filter(Users.Username==username).one_or_none()
        return user
    
    def get_user(self, user_id: int) -> Users:
        """
        Retrieves a user from the database by their ID.

        Args:
            user_id (int): The ID of the user to retrieve.

        Returns:
            Users: The user object if found, otherwise None.
        """
        user = Users.query.filter(Users.Id == user_id).one_or_none()
        return user

    #TODO: Remove in favor of calling get_user
    def get_user_by_id(self,user_id: int) -> str:
        """
        Returns the username of a user given their ID.

        Args:
            user_id (int): The ID of the user to retrieve.

        Returns:
            str: The username of the user with the given ID.
        """
        user = Users.query.filter(Users.Id==user_id).one_or_none()
        return user.Username
    def doesUserExist(self, username: str) -> bool:
        """Checks if a user with the given username exists in the database.

        Args:
            username (str): The username to check.

        Returns:
            bool: True if a user with the given username exists, False otherwise.
        """
        user = Users.query.filter(Users.Username==username).first()
        
        return user is not None

    def create_user(self, username: str, first_name: str, last_name: str, email: str, student_number: str):
        """Creates a new user with the given information and adds it to the database.

        Args:
            username (str): The username of the new user.
            first_name (str): The first name of the new user.
            last_name (str): The last name of the new user.
            email (str): The email address of the new user.
            student_number (str): The student number of the new user.

        Returns:
            None
        """
        user = Users(Username=username,Firstname=first_name,Lastname=last_name,Email=email,StudentNumber=student_number,Role = 0,IsLocked=False,ResearchGroup=0)
        db.session.add(user)
        db.session.commit()
    def get_all_users(self) -> List[Users]:
        """Retrieves all users from the database.

        Returns:
            List[Users]: A list of all user objects in the database.
        """
        user = Users.query.all()
        return user
    def get_all_users_by_cid(self, class_id) -> List[Users]:
        """Returns a list of all users associated with a given class ID.

        Args:
            class_id (int): The ID of the class to retrieve users for.

        Returns:
            List[Users]: A list of all users associated with the given class ID.
        """
        users_in_class = db.session.query(ClassAssignments).join(Users, ClassAssignments.UserId == Users.Id).filter(
            and_(ClassAssignments.ClassId == class_id, Users.Role != 1)
        ).all()
        users = []
        for user in users_in_class:
            users.append(Users.query.filter(Users.Id==user.UserId).one_or_none())
        return users
    def send_attempt_data(self, username: str, ipadr: str, time: datetime):
        """Adds a new login attempt to the database. This is only triggered should a user fail to sign in, used to prevent brute force attacks

        Args:
            username (str): The username used in the login attempt.
            ipadr (str): The IP address of the device used in the login attempt.
            time (datetime): The date and time of the login attempt.

        Returns:
            None
        """
        login_attempt = LoginAttempts(IPAddress=ipadr, Username=username, Time=time)
        db.session.add(login_attempt)
        db.session.commit()

    def can_user_login(self, username: str) -> int:
        """Returns the number of login attempts made by a user with the given username.

        Args:
            username (str): The username of the user to check.

        Returns:
            int: The number of login attempts made by the user.
        """
        number = LoginAttempts.query.filter(LoginAttempts.Username == username).count()
        return number
        
    def clear_failed_attempts(self, username: str):
        """Deletes all login attempts for a given username from the database. This should trigger when a student logs in successfully.

        Args:
            username (str): The username for which to delete login attempts.

        Returns:
            None
        """
        attempts = LoginAttempts.query.filter(LoginAttempts.Username == username).all()
        for attempt in attempts:
            db.session.delete(attempt)
        db.session.commit()

    def lock_user_account(self, username: str):
        """Locks the user account associated with the given username. This triggers if the same username fails to login 5 times in a row. 

        Args:
            username (str): The username of the user account to be locked.

        Returns:
            None
        """
        query = Users.query.filter(Users.Username==username).one()
        query.IsLocked=True
        db.session.commit()
    
    def get_user_lectures(self, userIds: List[int], class_id) -> Dict[int, ClassAssignments]:
        """Returns a dictionary of lecture names for each user in the given list of user IDs.
        
        Args:
            userIds (List[int]): A list of user IDs for which to retrieve lecture names.
            
        Returns:
            Dict[int, ClassAssignments]: A dictionary where the keys are user IDs and the values are the names of the lectures
            assigned to each user.
        """
        #TODO: Do we still use this? seems to only work for single class submissions.
        class_assignments = ClassAssignments.query.filter(and_(ClassAssignments.UserId.in_(userIds), ClassAssignments.ClassId == class_id)).all()
        
        user_lectures_dict={}
        for class_assignment in class_assignments:
            user_lectures_dict[class_assignment.UserId] = LectureSections.query.filter(LectureSections.Id == class_assignment.LectureId).one().Name

        return user_lectures_dict

    def get_user_labs(self, userIds: List[int], class_id) -> Dict[int, int]:
        """
        Returns a dictionary mapping each userId to their Lab number for the given class.
        If a user has no lab assigned, the value is -1.

        Args:
            userIds (List[int]): Users to look up.
            class_id (int): Class context for the assignments.

        Returns:
            Dict[int, int]: { user_id: lab_number }
        """
        # Start with all users defaulting to -1 to avoid KeyErrors in callers.
        user_labs_dict: Dict[int, int] = {uid: -1 for uid in userIds}

        # Fetch class assignments for these users within this class.
        class_assignments = ClassAssignments.query.filter(
            and_(ClassAssignments.UserId.in_(userIds), ClassAssignments.ClassId == class_id)
        ).all()

        for ca in class_assignments:
            lab_number = -1

            # Expecting ClassAssignments to have a LabId foreign key to Labs.Id.
            lab_id = getattr(ca, "LabId", None)
            if lab_id is not None:
                lab = Labs.query.filter(Labs.Id == lab_id).one_or_none()
                if lab is not None:
                    # Prefer an explicit numeric column if it exists (e.g., Labs.Number).
                    if hasattr(lab, "Number") and lab.Number is not None:
                        try:
                            lab_number = int(lab.Number)
                        except (TypeError, ValueError):
                            lab_number = -1
                    # Fallback: try to parse a number from a name like "Lab 3"
                    elif hasattr(lab, "Name") and lab.Name:
                        m = re.search(r"\d+", str(lab.Name))
                        if m:
                            lab_number = int(m.group(0))

            user_labs_dict[ca.UserId] = lab_number

        return user_labs_dict
        
    def get_user_email(self, userId) -> str:
        """
        Retrieves the email of a user with the given userId.

        Args:
            userId (int): The ID of the user to retrieve the email for.

        Returns:
            str: The email of the user with the given userId.
        """
        query = Users.query.filter(Users.Id==userId).one()
        email = query.Email
        return email
    def get_user_researchgroup(self, userId) -> int:
        """
        Retrieves the research group of a user with the given ID.

        Args:
            userId (int): The ID of the user to retrieve the research group for.

        Returns:
            str: The research group of the user as a string.
        """
        query = Users.query.filter(Users.Id==userId).one()
        research_group = query.ResearchGroup
        return str(research_group)
    def get_StudentNumber(self, user_id):
        """
        Returns the student number of a user with the given user_id.

        Args:
        - user_id: int, the id of the user whose student number is to be retrieved.

        Returns:
        - StudentNumber: str, the student number of the user with the given user_id.
        """
        query = Users.query.filter(Users.Id==user_id).one()
        StudentNumber = query.StudentNumber
        return StudentNumber
    def unlock_student_account(self, user_id):
        """
        Unlocks the account of a student with the given user_id. A user's account can be locked if they fail to login 5 times in a row.

        Args:
        - user_id: int, the id of the user whose account is to be unlocked.

        Returns:
        - None
        """
        query = Users.query.filter(Users.Id==user_id).one()
        query.IsLocked = 0
        db.session.commit()
        query = LoginAttempts.query.filter(LoginAttempts.Username==query.Username).all()
        for attempt in query:
            db.session.delete(attempt)
        db.session.commit()