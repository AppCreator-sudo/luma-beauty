export function installAddressProvider(){
  const original=globalThis.fetch,cityId='11111111-1111-4111-8111-111111111111',houseId='22222222-2222-4222-8222-222222222222';
  globalThis.fetch=async(url,options)=>{
    if(String(url).startsWith('https://suggestions.dadata.ru/')){
      const b=JSON.parse(options.body),q=b.query.toLocaleLowerCase('ru-RU');
      if(!options.headers.Authorization||options.headers['X-Secret'])throw Error('Fixture authentication invalid');
      if(q.includes('сбой'))return new Response('PRIVATE_PROVIDER_DETAILS',{status:503});
      const base={country_iso_code:'RU',city:'Новосибирск',city_fias_id:cityId,region_with_type:'Новосибирская обл',fias_actuality_state:'0'};
      if(b.from_bound?.value==='city')return Response.json({suggestions:q.includes('новосибирск')?[{value:'г Новосибирск',data:{...base,fias_level:'4'}}]:[]});
      const road=q.includes('пример')?'Пример':q.includes('задержка')?'Задержка':q.includes('удаленная')?'Удаленная':'Громова';
      if(q.includes('задержка'))await new Promise(r=>setTimeout(r,350));
      const block=q.includes('корпус 3')||q.includes('к 3')?'3':null;
      const data={...base,street_with_type:'ул '+road,house:'21',house_type:'д',block,block_type:'корпус',house_fias_id:houseId,fias_level:'8',geo_lat:'54.958',geo_lon:'82.897',qc_geo:road==='Пример'?'2':'0'};
      if(q.includes('улица без дома')){data.house=null;data.fias_level='7'}
      if(q.includes('удаленная')&&b.count===1)data.fias_actuality_state='99';
      const value='г Новосибирск, ул '+road+', д 21'+(block?', корпус '+block:'');
      return Response.json({suggestions:[{value,unrestricted_value:value,data,private:'PRIVATE_PROVIDER_DETAILS'}]});
    }
    if(String(url).startsWith('https://nominatim.openstreetmap.org/'))return Response.json([]);
    return original(url,options);
  };
}
