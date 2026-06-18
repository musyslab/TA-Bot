from datetime import datetime

from sqlalchemy import Column, Integer, String, Boolean, Text
from sqlalchemy.orm import relationship
from sqlalchemy.sql.schema import ForeignKey
from sqlalchemy.sql.sqltypes import DateTime
from sqlalchemy.types import Date

from src.repositories.database import db

class Schools(db.Model):
    __tablename__ = "Schools"
    Id = Column(Integer, primary_key=True, autoincrement=True)
    Name = Column(String)
    Classes = relationship('Classes', back_populates='School')


class Modules(db.Model):
    __tablename__ = "Modules"
    Id = Column(Integer, primary_key=True, autoincrement=True)
    ClassId = Column(Integer, ForeignKey('Classes.Id'))
    Name = Column(String)
    FirstName = Column(String)
    FileTimestamp = Column(String)
    Start = Column(DateTime)
    End = Column(DateTime)
    Projects = relationship('Projects', back_populates='Module')

class Projects(db.Model):
    __tablename__ = "Projects"
    Id = Column(Integer, primary_key=True, autoincrement=True)
    ClassId = Column(Integer, ForeignKey('Classes.Id'))
    ModuleId = Column(Integer, ForeignKey('Modules.Id'), nullable=True)
    Module = relationship('Modules', back_populates='Projects')
    Name = Column(String)
    FirstName = Column(String)
    Language = Column(String)
    Submissions=relationship('Submissions') 
    solutionpath=Column(String)
    AsnDescriptionPath = Column(String)
    AdditionalFilePath = Column(String)
    Checkpoints = relationship('Checkpoints', back_populates='Project', cascade="all, delete-orphan")

class Checkpoints(db.Model):
    __tablename__ = "Checkpoints"
    Id = Column(Integer, primary_key=True, autoincrement=True)
    ProjectId = Column(Integer, ForeignKey('Projects.Id', ondelete='CASCADE'), nullable=False)
    CheckpointNumber = Column(Integer, nullable=False, default=1)
    Enabled = Column(Boolean, nullable=False, default=True)
    Name = Column(String)
    FirstName = Column(String)
    Language = Column(String)
    solutionpath = Column(String)
    AsnDescriptionPath = Column(String)
    AdditionalFilePath = Column(String)
    Project = relationship('Projects', back_populates='Checkpoints')

class Users(db.Model):
    __tablename__ = "Users"
    Id = Column(Integer, primary_key=True, autoincrement=True)
    Username = Column(String)
    Firstname = Column(String)
    Lastname = Column(String)
    Email = Column(String)
    StudentNumber = Column(String)
    IsLocked = Column(Boolean)
    Submissions=relationship('Submissions')
    ClassAssignments=relationship('ClassAssignments')
    LoginAttempts=relationship('LoginAttempts')

class Submissions(db.Model):
    __tablename__ = "Submissions"
    Id = Column(Integer, primary_key=True)
    OutputFilepath = Column(String)
    CodeFilepath = Column(String)
    IsPassing = Column(Boolean, nullable=False, default=False)
    IsCheckpoint = Column(Boolean, nullable=False, default=False)
    CheckpointId = Column(Integer, ForeignKey('Checkpoints.Id'), nullable=True)
    Time = Column(Date)
    User = Column(Integer, ForeignKey('Users.Id'))
    Project = Column(Integer, ForeignKey('Projects.Id'))
    TestCaseResults=Column(String)

class LoginAttempts(db.Model):
    __tablename__ = "LoginAttempts"
    Id = Column(Integer, primary_key=True)
    Time = Column(Date)
    IPAddress = Column(String)
    Username = Column(String, ForeignKey('Users.Username'))

class Classes(db.Model):
    __tablename__ = "Classes"
    Id = Column(Integer, primary_key=True)
    Name = Column(String)
    SchoolId = Column(Integer, ForeignKey('Schools.Id'))
    School = relationship('Schools', back_populates='Classes')

class Labs(db.Model):
    __tablename__ = "Labs"
    Id = Column(Integer, primary_key=True)
    Name = Column(String)
    ClassId = Column(Integer, ForeignKey('Classes.Id'))
    ClassAssignments=relationship('ClassAssignments')

class LectureSections(db.Model):
    __tablename__ = "LectureSections"
    Id = Column(Integer, primary_key=True)
    Name = Column(String)
    ClassId = Column(Integer, ForeignKey('Classes.Id'), primary_key=True)
    ClassAssignments=relationship('ClassAssignments')

class ClassAssignments(db.Model):
    __tablename__ = "ClassAssignments"
    UserId = Column(Integer, ForeignKey('Users.Id'), primary_key=True)
    ClassId = Column(Integer, ForeignKey('Classes.Id'), primary_key=True)
    LabId = Column(Integer, ForeignKey('Labs.Id'))
    LectureId = Column(Integer, ForeignKey('LectureSections.Id'))
    Role = Column(Integer, nullable=False, default=0)


class StudentHiddenModules(db.Model):
    __tablename__ = "StudentHiddenModules"
    UserId = Column(Integer, ForeignKey('Users.Id'), primary_key=True)
    ModuleId = Column(Integer, ForeignKey('Modules.Id'), primary_key=True)
    CreatedAt = Column(DateTime)


class Testcases(db.Model):
    __tablename__ = "Testcases"
    Id = Column(Integer, primary_key=True, autoincrement=True)
    ProjectId = Column(Integer, ForeignKey('Projects.Id'))
    CheckpointId = Column(Integer, ForeignKey('Checkpoints.Id'), nullable=True)
    Name = Column(String)
    Description = Column(String)
    input = Column(String)
    Output = Column(String)
    Hidden = Column(Boolean, default=False)
    Checkpoint = Column(Boolean, default=False)


class MainAssignmentGrades(db.Model):
    __tablename__ = "MainAssignmentGrades"
    Sid = Column(Integer, ForeignKey('Users.Id'), primary_key=True)
    Pid = Column(Integer, ForeignKey('Projects.Id'), primary_key=True)
    Grade = Column(Integer)
    SubmissionId = Column(Integer, ForeignKey('Submissions.Id'))
    ScoringMode = Column(String(20))
    ErrorPointsJson = Column(Text)
    ErrorDefsJson = Column(Text)
    UpdatedAt = Column(DateTime)


class CheckpointGrades(db.Model):
    __tablename__ = "CheckpointGrades"
    SubmissionId = Column(Integer, ForeignKey('Submissions.Id'), primary_key=True)
    Sid = Column(Integer, ForeignKey('Users.Id'))
    Pid = Column(Integer, ForeignKey('Projects.Id'))
    Grade = Column(Integer)
    ScoringMode = Column(String(20))
    ErrorPointsJson = Column(Text)
    ErrorDefsJson = Column(Text)
    UpdatedAt = Column(DateTime)


class StudentUploadState(db.Model):
    __tablename__ = "StudentUploadState"
    UserId = Column(Integer, ForeignKey('Users.Id'), primary_key=True)
    ClassId = Column(Integer, ForeignKey('Classes.Id'), primary_key=True)
    ProjectId = Column(Integer, ForeignKey('Projects.Id'), primary_key=True)
    CheckpointId = Column(Integer, primary_key=True, nullable=False, default=0)
    CooldownLiftedAt = Column(DateTime, nullable=True)


class StudentStarBalance(db.Model):
    __tablename__ = "StudentStarBalance"
    UserId = Column(Integer, ForeignKey('Users.Id'), primary_key=True)
    ClassId = Column(Integer, ForeignKey('Classes.Id'), primary_key=True)
    Stars = Column(Integer, nullable=False, default=0)
    UpdatedAt = Column(DateTime, nullable=False, default=datetime.utcnow)


class StudentStarAwards(db.Model):
    __tablename__ = "StudentStarAwards"
    UserId = Column(Integer, ForeignKey('Users.Id'), primary_key=True)
    ClassId = Column(Integer, ForeignKey('Classes.Id'), primary_key=True)
    ProjectId = Column(Integer, ForeignKey('Projects.Id'), primary_key=True)
    CheckpointId = Column(Integer, primary_key=True, nullable=False, default=0)
    AwardType = Column(String(40), primary_key=True)
    Stars = Column(Integer, nullable=False, default=0)
    BaseStars = Column(Integer, nullable=False, default=0)
    Multiplier = Column(Integer, nullable=False, default=1)
    StartedEarly = Column(Boolean, nullable=False, default=False)
    SubmissionId = Column(Integer, ForeignKey('Submissions.Id'), nullable=True)
    AwardedAt = Column(DateTime, nullable=False, default=datetime.utcnow)


class StudentStarSpending(db.Model):
    __tablename__ = "StudentStarSpending"
    Id = Column(Integer, primary_key=True, autoincrement=True)
    UserId = Column(Integer, ForeignKey('Users.Id'), nullable=False)
    ClassId = Column(Integer, ForeignKey('Classes.Id'), nullable=False)
    ProjectId = Column(Integer, ForeignKey('Projects.Id'), nullable=True)
    CheckpointId = Column(Integer, nullable=False, default=0)
    SpendType = Column(String(40), nullable=False)
    Stars = Column(Integer, nullable=False, default=0)
    CreatedAt = Column(DateTime, nullable=False, default=datetime.utcnow)


class StudentCheckpointSkips(db.Model):
    __tablename__ = "StudentCheckpointSkips"
    UserId = Column(Integer, ForeignKey('Users.Id'), primary_key=True)
    ClassId = Column(Integer, ForeignKey('Classes.Id'), primary_key=True)
    ProjectId = Column(Integer, ForeignKey('Projects.Id'), primary_key=True)
    CheckpointId = Column(Integer, ForeignKey('Checkpoints.Id'), primary_key=True)
    SpentStars = Column(Integer, nullable=False, default=0)
    CreatedAt = Column(DateTime, nullable=False, default=datetime.utcnow)


class StudentCooldownSkips(db.Model):
    __tablename__ = "StudentCooldownSkips"
    Id = Column(Integer, primary_key=True, autoincrement=True)
    UserId = Column(Integer, ForeignKey('Users.Id'), nullable=False)
    ClassId = Column(Integer, ForeignKey('Classes.Id'), nullable=False)
    ProjectId = Column(Integer, ForeignKey('Projects.Id'), nullable=True)
    CheckpointId = Column(Integer, nullable=False, default=0)
    SpentStars = Column(Integer, nullable=False, default=0)
    CreatedAt = Column(DateTime, nullable=False, default=datetime.utcnow)
    UsedAt = Column(DateTime, nullable=True)


class StudentSuggestions(db.Model):
    __tablename__ = "StudentSuggestions"
    idStudentSuggestions = Column(Integer, primary_key=True, autoincrement=True)
    UserId = Column(Integer)
    StudentSuggestionscol = Column(String)
    TimeSubmitted = Column(DateTime)


class SubmissionManualErrors(db.Model):
    __tablename__ = "SubmissionManualErrors"
    Id = Column(Integer, primary_key=True, autoincrement=True)
    SubmissionId = Column(Integer, ForeignKey('Submissions.Id'))
    StartLine = Column(Integer)
    EndLine = Column(Integer)
    ErrorId = Column(String(80))
    Count = Column(Integer)
    Note = Column(String(2000))