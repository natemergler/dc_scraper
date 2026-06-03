-- Count accepted entities by kind.
select kind, count(*) as count
from entities
where review_status = 'accepted'
group by kind
order by count desc, kind;

-- Show every accepted relationship touching one entity.
select relationship_type, from_entity_id, to_entity_id
from relationships
where review_status = 'accepted'
  and (from_entity_id = 'dc.board_of_accountancy' or to_entity_id = 'dc.board_of_accountancy')
order by relationship_type, from_entity_id, to_entity_id;

-- See the latest public source inventory snapshot.
select source_id, title, latest_status, latest_run_finished_at
from sources
order by source_id;

-- Inspect accepted legal refs attached to one entity.
select entity_name, ref_type, normalized_citation, review_status
from entity_legal_refs
where entity_id = 'dc.board_of_accountancy'
order by ref_type, normalized_citation;
