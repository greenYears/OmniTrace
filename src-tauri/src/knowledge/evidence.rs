use std::collections::HashMap;

use super::models::{DocType, EvidenceType, KnowledgeEvidence};

pub fn deduplicate_evidence(mut evidence: Vec<KnowledgeEvidence>) -> Vec<KnowledgeEvidence> {
    let mut seen: HashMap<(String, String), usize> = HashMap::new();
    let mut result: Vec<KnowledgeEvidence> = Vec::new();

    for ev in evidence.drain(..) {
        let key = (ev.title.clone(), ev.evidence_type.as_str().to_string());
        if let Some(&idx) = seen.get(&key) {
            // Keep the one with higher confidence
            if ev.confidence > result[idx].confidence {
                result[idx] = ev;
            } else {
                // Merge source_refs from duplicate
                let existing_refs_len = result[idx].source_refs.len();
                if existing_refs_len < 5 {
                    result[idx].source_refs.extend(ev.source_refs);
                }
            }
        } else {
            seen.insert(key, result.len());
            result.push(ev);
        }
    }

    // Sort by confidence descending, then by source_refs count
    result.sort_by(|a, b| {
        b.confidence
            .partial_cmp(&a.confidence)
            .unwrap_or(std::cmp::Ordering::Equal)
            .then_with(|| b.source_refs.len().cmp(&a.source_refs.len()))
    });

    result
}

pub fn filter_by_confidence(evidence: Vec<KnowledgeEvidence>, min: f64) -> Vec<KnowledgeEvidence> {
    evidence.into_iter().filter(|e| e.confidence >= min).collect()
}

pub fn group_by_doc_type(evidence: Vec<KnowledgeEvidence>) -> HashMap<DocType, Vec<KnowledgeEvidence>> {
    let mut groups: HashMap<DocType, Vec<KnowledgeEvidence>> = HashMap::new();

    for ev in evidence {
        let doc_type = match ev.evidence_type {
            EvidenceType::TaskPattern | EvidenceType::Verification | EvidenceType::FileArea => {
                DocType::CommonTasks
            }
            EvidenceType::DomainRule => DocType::DomainRules,
            EvidenceType::Pitfall => DocType::Pitfalls,
        };
        groups.entry(doc_type).or_default().push(ev);
    }

    groups
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::knowledge::models::{EvidenceContent, SourceRef};

    fn make_evidence(title: &str, etype: EvidenceType, confidence: f64) -> KnowledgeEvidence {
        KnowledgeEvidence {
            id: uuid::Uuid::new_v4().to_string(),
            run_id: "run1".to_string(),
            project_id: "proj1".to_string(),
            evidence_type: etype,
            title: title.to_string(),
            content: EvidenceContent {
                summary: "s".to_string(),
                details: "d".to_string(),
                recommended_action: "a".to_string(),
                related_files: vec![],
            },
            confidence,
            source_refs: vec![SourceRef {
                session_title: "session".to_string(),
                timestamp: "2026-01-01".to_string(),
                excerpt: "ex".to_string(),
            }],
            created_at: "2026-01-01".to_string(),
        }
    }

    #[test]
    fn dedup_removes_exact_title_type_duplicates() {
        let ev1 = make_evidence("Bug fix", EvidenceType::Pitfall, 0.8);
        let ev2 = make_evidence("Bug fix", EvidenceType::Pitfall, 0.6);
        let result = deduplicate_evidence(vec![ev1, ev2]);
        assert_eq!(result.len(), 1);
        assert_eq!(result[0].confidence, 0.8);
    }

    #[test]
    fn dedup_keeps_different_types_with_same_title() {
        let ev1 = make_evidence("Auth", EvidenceType::Pitfall, 0.8);
        let ev2 = make_evidence("Auth", EvidenceType::DomainRule, 0.7);
        let result = deduplicate_evidence(vec![ev1, ev2]);
        assert_eq!(result.len(), 2);
    }

    #[test]
    fn filter_removes_low_confidence() {
        let ev1 = make_evidence("A", EvidenceType::Pitfall, 0.8);
        let ev2 = make_evidence("B", EvidenceType::Pitfall, 0.2);
        let result = filter_by_confidence(vec![ev1, ev2], 0.3);
        assert_eq!(result.len(), 1);
        assert_eq!(result[0].title, "A");
    }

    #[test]
    fn group_maps_types_correctly() {
        let ev1 = make_evidence("A", EvidenceType::TaskPattern, 0.8);
        let ev2 = make_evidence("B", EvidenceType::DomainRule, 0.7);
        let ev3 = make_evidence("C", EvidenceType::Pitfall, 0.9);
        let ev4 = make_evidence("D", EvidenceType::Verification, 0.6);

        let groups = group_by_doc_type(vec![ev1, ev2, ev3, ev4]);
        assert_eq!(groups.get(&DocType::CommonTasks).unwrap().len(), 2);
        assert_eq!(groups.get(&DocType::DomainRules).unwrap().len(), 1);
        assert_eq!(groups.get(&DocType::Pitfalls).unwrap().len(), 1);
    }
}
