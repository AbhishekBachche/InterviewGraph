from parsers.jd_parser import extract_from_jd

def get_jd_skills(jd_text):
    """
    Wrapper for extracting skills from a Job Description text.
    Returns:
        - mandatory skills (List[str])
        - optional skills (List[str])
        - skill_variations (Dict[str, List[str]])
        - certifications (List[str])
    """
    out = extract_from_jd(jd_text)
    if isinstance(out, tuple) and len(out) == 4:
        return out
    # Backward compatibility with legacy parser shape.
    mandatory, optional, variations = out
    return mandatory, optional, variations, []
