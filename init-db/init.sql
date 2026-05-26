SET FOREIGN_KEY_CHECKS=0;

--
-- Table structure for table `Schools`
--

DROP TABLE IF EXISTS `Schools`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `Schools` (
  `Id` int NOT NULL AUTO_INCREMENT,
  `Name` varchar(255) NOT NULL,
  PRIMARY KEY (`Id`),
  UNIQUE KEY `Name_UNIQUE` (`Name`)
) ENGINE=InnoDB AUTO_INCREMENT=2 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `Users`
--

DROP TABLE IF EXISTS `Users`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `Users` (
  `Id` int NOT NULL AUTO_INCREMENT,
  `Username` varchar(45) NOT NULL,
  `Firstname` varchar(45) NOT NULL,
  `Lastname` varchar(45) NOT NULL,
  `Email` varchar(256) NOT NULL,
  `StudentNumber` varchar(45) NOT NULL,
  `IsLocked` tinyint(1) NOT NULL,
  PRIMARY KEY (`Id`),
  UNIQUE KEY `idusers_UNIQUE` (`Id`),
  UNIQUE KEY `username_UNIQUE` (`Username`)
) ENGINE=InnoDB AUTO_INCREMENT=176 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='This is a table to store website login''s and all users';
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `Classes`
--

DROP TABLE IF EXISTS `Classes`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `Classes` (
  `Id` int NOT NULL AUTO_INCREMENT,
  `Name` varchar(45) NOT NULL,
  `SchoolId` int NOT NULL,
  PRIMARY KEY (`Id`),
  UNIQUE KEY `Name_UNIQUE` (`Name`),
  KEY `fk_Classes_1_idx` (`SchoolId`),
  CONSTRAINT `fk_Classes_1` FOREIGN KEY (`SchoolId`) REFERENCES `Schools` (`Id`)
) ENGINE=InnoDB AUTO_INCREMENT=7 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `Labs`
--

DROP TABLE IF EXISTS `Labs`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `Labs` (
  `Id` int NOT NULL AUTO_INCREMENT,
  `Name` varchar(45) NOT NULL,
  `ClassId` int NOT NULL,
  PRIMARY KEY (`Id`),
  KEY `fk_Labs_1_idx` (`ClassId`),
  CONSTRAINT `fk_Labs_1` FOREIGN KEY (`ClassId`) REFERENCES `Classes` (`Id`)
) ENGINE=InnoDB AUTO_INCREMENT=23 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `LectureSections`
--

DROP TABLE IF EXISTS `LectureSections`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `LectureSections` (
  `Id` int NOT NULL AUTO_INCREMENT,
  `Name` varchar(45) NOT NULL,
  `ClassId` int NOT NULL,
  PRIMARY KEY (`Id`),
  KEY `fk_LectureSections_1_idx` (`ClassId`),
  CONSTRAINT `fk_LectureSections_1` FOREIGN KEY (`ClassId`) REFERENCES `Classes` (`Id`)
) ENGINE=InnoDB AUTO_INCREMENT=34 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `Modules`
--

DROP TABLE IF EXISTS `Modules`;
CREATE TABLE `Modules` (
  `Id` int NOT NULL AUTO_INCREMENT,
  `ClassId` int NOT NULL,
  `Name` varchar(1000) NOT NULL,
  `FirstName` varchar(1000) DEFAULT NULL,
  `FileTimestamp` varchar(32) DEFAULT NULL,
  `Start` datetime NOT NULL,
  `End` datetime NOT NULL,
  PRIMARY KEY (`Id`),
  KEY `idx_Modules_ClassId` (`ClassId`),
  CONSTRAINT `fk_Modules_Class` FOREIGN KEY (`ClassId`) REFERENCES `Classes` (`Id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

--
-- Table structure for table `Projects`
--

DROP TABLE IF EXISTS `Projects`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `Projects` (
  `Id` int NOT NULL AUTO_INCREMENT COMMENT 'Table to keep track of projects',
  `Name` varchar(1000) NOT NULL,
  `FirstName` varchar(1000) DEFAULT NULL,
  `Language` varchar(45) NOT NULL,
  `ClassId` int NOT NULL,
  `ModuleId` int DEFAULT NULL,
  `solutionpath` varchar(1000) DEFAULT NULL,
  `AsnDescriptionPath` varchar(1000) DEFAULT NULL,
  `AdditionalFilePath` varchar(200) DEFAULT NULL,
  PRIMARY KEY (`Id`),
  UNIQUE KEY `idProjects_UNIQUE` (`Id`),
  KEY `fk_Projects_1_idx` (`ClassId`),
  KEY `idx_Projects_ModuleId` (`ModuleId`),
  CONSTRAINT `fk_Projects_1` FOREIGN KEY (`ClassId`) REFERENCES `Classes` (`Id`),
  CONSTRAINT `fk_Projects_Module` FOREIGN KEY (`ModuleId`) REFERENCES `Modules` (`Id`) ON DELETE SET NULL
) ENGINE=InnoDB AUTO_INCREMENT=41 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `Checkpoints`
--

DROP TABLE IF EXISTS `Checkpoints`;
CREATE TABLE `Checkpoints` (
  `Id` int NOT NULL AUTO_INCREMENT,
  `ProjectId` int NOT NULL,
  `CheckpointNumber` int NOT NULL DEFAULT 1,
  `Enabled` tinyint(1) NOT NULL DEFAULT 1,
  `Name` varchar(255) DEFAULT NULL,
  `FirstName` varchar(255) DEFAULT NULL,
  `Language` varchar(45) DEFAULT NULL,
  `solutionpath` varchar(1000) DEFAULT NULL,
  `AsnDescriptionPath` varchar(1000) DEFAULT NULL,
  `AdditionalFilePath` varchar(200) DEFAULT NULL,
  `CreatedAt` datetime DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`Id`),
  KEY `idx_Checkpoints_ProjectId` (`ProjectId`),
  KEY `idx_Checkpoints_Project_Number` (`ProjectId`, `CheckpointNumber`),
  UNIQUE KEY `uq_Checkpoints_Project_Number` (`ProjectId`, `CheckpointNumber`),
  CONSTRAINT `fk_Checkpoints_Project` FOREIGN KEY (`ProjectId`)
    REFERENCES `Projects` (`Id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

--
-- Table structure for table `ClassAssignments`
--

DROP TABLE IF EXISTS `ClassAssignments`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `ClassAssignments` (
  `UserId` int NOT NULL,
  `ClassId` int NOT NULL,
  `LabId` int NOT NULL,
  `LectureId` int NOT NULL,
  `Role` int NOT NULL DEFAULT 0,
  PRIMARY KEY (`UserId`,`ClassId`),
  KEY `fk_ClassAssignments_1_idx` (`ClassId`),
  KEY `fk_ClassAssignments_4_idx` (`LectureId`),
  KEY `fk_ClassAssignments_2_idx` (`LabId`),
  CONSTRAINT `fk_ClassAssignments_1` FOREIGN KEY (`ClassId`) REFERENCES `Classes` (`Id`),
  CONSTRAINT `fk_ClassAssignments_2` FOREIGN KEY (`LabId`) REFERENCES `Labs` (`Id`),
  CONSTRAINT `fk_ClassAssignments_3` FOREIGN KEY (`UserId`) REFERENCES `Users` (`Id`),
  CONSTRAINT `fk_ClassAssignments_4` FOREIGN KEY (`LectureId`) REFERENCES `LectureSections` (`Id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `StudentHiddenModules`
--

DROP TABLE IF EXISTS `StudentHiddenModules`;
CREATE TABLE `StudentHiddenModules` (
  `UserId` int NOT NULL,
  `ModuleId` int NOT NULL,
  `CreatedAt` datetime DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`UserId`,`ModuleId`),
  KEY `idx_StudentHiddenModules_ModuleId` (`ModuleId`),
  CONSTRAINT `fk_StudentHiddenModules_User` FOREIGN KEY (`UserId`) REFERENCES `Users` (`Id`) ON DELETE CASCADE,
  CONSTRAINT `fk_StudentHiddenModules_Module` FOREIGN KEY (`ModuleId`) REFERENCES `Modules` (`Id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

--
-- Table structure for table `LoginAttempts`
--

DROP TABLE IF EXISTS `LoginAttempts`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `LoginAttempts` (
  `Id` int NOT NULL AUTO_INCREMENT,
  `Time` datetime NOT NULL,
  `IPAddress` varchar(39) NOT NULL,
  `Username` varchar(45) NOT NULL,
  PRIMARY KEY (`Id`),
  KEY `fk_LoginAttempts_1_idx` (`Username`)
) ENGINE=InnoDB AUTO_INCREMENT=95 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `Submissions`
--

DROP TABLE IF EXISTS `Submissions`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `Submissions` (
  `Id` int NOT NULL AUTO_INCREMENT COMMENT 'Table to keep track of submissions from users',
  `User` int NOT NULL,
  `Time` datetime NOT NULL,
  `OutputFilepath` varchar(256) NOT NULL,
  `Project` int NOT NULL,
  `CodeFilepath` varchar(256) NOT NULL,
  `IsPassing` tinyint(1) NOT NULL,
  `IsCheckpoint` tinyint(1) NOT NULL,
  `CheckpointId` int DEFAULT NULL,
  `TestCaseResults` text,
  PRIMARY KEY (`Id`),
  UNIQUE KEY `idSubmissions_UNIQUE` (`Id`),
  KEY `iduser_idx` (`User`),
  KEY `projectmap_idx` (`Project`),
  KEY `idx_Submissions_CheckpointId` (`CheckpointId`),
  CONSTRAINT `iduser` FOREIGN KEY (`User`) REFERENCES `Users` (`Id`),
  CONSTRAINT `proect` FOREIGN KEY (`Project`) REFERENCES `Projects` (`Id`),
  CONSTRAINT `fk_Submissions_Checkpoint` FOREIGN KEY (`CheckpointId`) REFERENCES `Checkpoints` (`Id`) ON DELETE SET NULL
) ENGINE=InnoDB AUTO_INCREMENT=2507 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `StudentUploadState`
--

DROP TABLE IF EXISTS `StudentUploadState`;
CREATE TABLE `StudentUploadState` (
  `UserId` int NOT NULL,
  `ClassId` int NOT NULL,
  `ProjectId` int NOT NULL,
  `CheckpointId` int NOT NULL DEFAULT 0,
  `CooldownLiftedAt` datetime DEFAULT NULL,
  PRIMARY KEY (`UserId`,`ClassId`,`ProjectId`,`CheckpointId`),
  KEY `idx_StudentUploadState_ClassId` (`ClassId`),
  KEY `idx_StudentUploadState_ProjectId` (`ProjectId`),
  KEY `idx_StudentUploadState_CheckpointId` (`CheckpointId`),
  KEY `idx_StudentUploadState_CooldownLiftedAt` (`CooldownLiftedAt`),
  CONSTRAINT `fk_StudentUploadState_User` FOREIGN KEY (`UserId`) REFERENCES `Users` (`Id`) ON DELETE CASCADE,
  CONSTRAINT `fk_StudentUploadState_Class` FOREIGN KEY (`ClassId`) REFERENCES `Classes` (`Id`) ON DELETE CASCADE,
  CONSTRAINT `fk_StudentUploadState_Project` FOREIGN KEY (`ProjectId`) REFERENCES `Projects` (`Id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

--
-- Table structure for table `Testcases`
--

DROP TABLE IF EXISTS `Testcases`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `Testcases` (
  `Id` int NOT NULL AUTO_INCREMENT,
  `ProjectId` int DEFAULT NULL,
  `CheckpointId` int DEFAULT NULL,
  `Name` text,
  `Description` text,
  `input` text,
  `Output` text,
  `Hidden` tinyint(1) NOT NULL DEFAULT 0,
  `Checkpoint` tinyint(1) NOT NULL DEFAULT 0,
  PRIMARY KEY (`Id`),
  UNIQUE KEY `Id_UNIQUE` (`Id`),
  KEY `tc_fk_idx` (`ProjectId`),
  KEY `idx_Testcases_CheckpointId` (`CheckpointId`),
  CONSTRAINT `tc_fk` FOREIGN KEY (`ProjectId`) REFERENCES `Projects` (`Id`),
  CONSTRAINT `fk_Testcases_Checkpoint` FOREIGN KEY (`CheckpointId`) REFERENCES `Checkpoints` (`Id`) ON DELETE CASCADE
) ENGINE=InnoDB AUTO_INCREMENT=192 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `MainAssignmentGrades`
--

DROP TABLE IF EXISTS `MainAssignmentGrades`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `MainAssignmentGrades` (
  `Sid` int NOT NULL,
  `Pid` int NOT NULL,
  `Grade` int NOT NULL,
  `SubmissionId` int DEFAULT NULL,
  `ScoringMode` varchar(20) DEFAULT NULL,
  `ErrorPointsJson` text,
  `ErrorDefsJson` text,
  `UpdatedAt` datetime DEFAULT NULL,
  PRIMARY KEY (`Sid`,`Pid`),
  KEY `idx_MainAssignmentGrades_Pid` (`Pid`),
  KEY `idx_MainAssignmentGrades_SubmissionId` (`SubmissionId`),
  CONSTRAINT `fk_main_assignment_grades_project` FOREIGN KEY (`Pid`) REFERENCES `Projects` (`Id`),
  CONSTRAINT `fk_main_assignment_grades_user` FOREIGN KEY (`Sid`) REFERENCES `Users` (`Id`),
  CONSTRAINT `fk_main_assignment_grades_submission` FOREIGN KEY (`SubmissionId`) REFERENCES `Submissions` (`Id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `CheckpointGrades`
--

DROP TABLE IF EXISTS `CheckpointGrades`;
CREATE TABLE `CheckpointGrades` (
  `SubmissionId` int NOT NULL,
  `Sid` int DEFAULT NULL,
  `Pid` int DEFAULT NULL,
  `Grade` int DEFAULT NULL,
  `ScoringMode` varchar(20) DEFAULT NULL,
  `ErrorPointsJson` text,
  `ErrorDefsJson` text,
  `UpdatedAt` datetime DEFAULT NULL,
  PRIMARY KEY (`SubmissionId`),
  KEY `idx_CheckpointGrades_Sid_Pid` (`Sid`,`Pid`),
  KEY `idx_CheckpointGrades_Pid` (`Pid`),
  CONSTRAINT `fk_checkpoint_grades_submission`
    FOREIGN KEY (`SubmissionId`) REFERENCES `Submissions` (`Id`) ON DELETE CASCADE,
  CONSTRAINT `fk_checkpoint_grades_user`
    FOREIGN KEY (`Sid`) REFERENCES `Users` (`Id`) ON DELETE SET NULL,
  CONSTRAINT `fk_checkpoint_grades_project`
    FOREIGN KEY (`Pid`) REFERENCES `Projects` (`Id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

--
-- Table structure for table `StudentSuggestions`
--

DROP TABLE IF EXISTS `StudentSuggestions`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `StudentSuggestions` (
  `idStudentSuggestions` int NOT NULL AUTO_INCREMENT,
  `UserId` int NOT NULL,
  `StudentSuggestionscol` text,
  `TimeSubmitted` datetime DEFAULT NULL,
  PRIMARY KEY (`idStudentSuggestions`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `SubmissionManualErrors`
--

DROP TABLE IF EXISTS `SubmissionManualErrors`;
CREATE TABLE `SubmissionManualErrors` (
  `Id` int NOT NULL AUTO_INCREMENT,
  `SubmissionId` int NOT NULL,
  `StartLine` int NOT NULL,
  `EndLine` int NOT NULL,
  `ErrorId` varchar(45) NOT NULL,
  `Count` int NOT NULL DEFAULT 1,
  `Note` text,
  PRIMARY KEY (`Id`),
  KEY `fk_sub_errors_idx` (`SubmissionId`),
  CONSTRAINT `fk_sub_errors` FOREIGN KEY (`SubmissionId`) REFERENCES `Submissions` (`Id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

--
-- Seed rows requested
--

INSERT INTO `Schools` (`Id`, `Name`)
VALUES (1, 'Marquette University');

INSERT INTO `Classes` (`Id`, `Name`, `SchoolId`)
VALUES (1, 'COSC 1010', 1);

INSERT INTO `Labs` (`Id`, `Name`, `ClassId`)
VALUES (1, '401', 1);

INSERT INTO `LectureSections` (`Id`, `Name`, `ClassId`)
VALUES (1, '101', 1);

SET FOREIGN_KEY_CHECKS=1;