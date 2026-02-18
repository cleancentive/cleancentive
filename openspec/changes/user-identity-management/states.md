cookies and sessions are auto created
there are only 2 possible states:
Browser cookie -> server session with ID and history -> no emails : "sign in" (if email exists merge with coresponsing account and point cookie to old session id, else attach email to this ID) 
Browser cookie -> server session with ID and history -> one or more emails : "sign out" -> new guest server session is created and cookie points to it



