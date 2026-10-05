/** Complete only references already declared by the supplied fixture. This is
 * test data adaptation, not gameplay resolution; historical inputs stay intact. */
export function withContainerCatalog(input, available) {
  const result=structuredClone(input),rows=result.catalog.entities.card;
  const known=new Map(rows.map(row=>[row.id,row])),source=new Map(available.map(row=>[row.id,row]));
  for(let index=0;index<rows.length;index++){
    if(rows.length>4096)throw Error('Fixture container closure exceeds its bound');
    const card=rows[index];if(!['all','choice'].includes(card.container_mode))continue;
    for(const child of card.contents??[]){
      if(known.has(child.card_id))continue;
      const row=source.get(child.card_id);if(!row)throw Error(`Missing fixture container declaration: ${child.card_id}`);
      const copied=structuredClone(row);known.set(copied.id,copied);rows.push(copied);
    }
  }
  return result;
}
