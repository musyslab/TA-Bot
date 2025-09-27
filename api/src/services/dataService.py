import os
from typing import List, Dict, Any
from src.repositories.submission_repository import SubmissionRepository
from src.repositories.user_repository import UserRepository
from src.repositories.project_repository import ProjectRepository
from src.plagiarism_detector import detect_plagiarism 

def run_local_plagiarism(projectid: int, submission_repository: SubmissionRepository, user_repository: UserRepository, project_repository: ProjectRepository) -> Dict[str, Any]:    
    """
    Collect the most recent submission file for each user in the project,
    then run a fully-local similarity analysis (robust to variable renaming).
    Returns a JSON-serializable dict with 'pairs'.
    """
    class_name = project_repository.get_className_by_projectId(projectid)
    class_id = project_repository.get_class_id_by_name(class_name)
    users = user_repository.get_all_users_by_cid(class_id)
    userids = [u.Id for u in users]
    bucket = submission_repository.get_most_recent_submission_by_project(projectid, userids)


    # Build a list of file entries with metadata for reporting/links
    entries: List[Dict[str, Any]] = []
    # Build a quick lookup for user names
    name_map: Dict[int, str] = {}
    for u in users:
        first = getattr(u, 'Firstname', None) or getattr(u, 'Fname', '')
        last  = getattr(u, 'Lastname',  None) or getattr(u, 'Lname',  '')
        name_map[u.Id] = (f"{first} {last}".strip() or f"User {u.Id}")

    for u in users:
        if u.Id in bucket:
            sub = bucket[u.Id]
            fp = sub.CodeFilepath
            if os.path.isdir(fp):
                files = [f for f in os.listdir(fp) if f.endswith((".py", ".java", ".c", ".cpp"))]
                pick = "Main.java" if "Main.java" in files else (files[0] if files else None)
                if pick:
                    fp = os.path.join(fp, pick)
            entries.append({
                "user_id": u.Id,
                "name": name_map.get(u.Id, f"User {u.Id}"),
                "class_id": str(class_id),
                "submission_id": getattr(sub, "Id", getattr(sub, "SubmissionId", -1)),
                "filepath": fp,
            })

    result = detect_plagiarism(entries)
    return result

def all_submissions(
     projectid: int,
     userId: int,  # kept for signature compatibility; not used
     submission_repository: SubmissionRepository,
     user_repository: UserRepository,
     project_repository: ProjectRepository,
 ) -> Dict[str, Any]:
     # userId is intentionally unused; we no longer email results.
     return run_local_plagiarism(projectid, submission_repository, user_repository, project_repository)