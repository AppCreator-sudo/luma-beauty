// Shared presentation for portfolios, publication galleries and the subscription feed.
export function mediaUI({esc,icon,money}) {
  let editorPhotos = [];
  const disposeEditor = () => {
    editorPhotos.filter(p => p.file).forEach(p => URL.revokeObjectURL(p.image));
    editorPhotos = [];
  };
  function gallery(work) {
    const photos = work.images?.length ? work.images : [{image:work.image}];
    return `<div class="photo-gallery" aria-label="Фотографии работы"><div class="photo-track" tabindex="0">${photos.map((p,i)=>`<img src="${esc(p.image)}" alt="${esc(work.caption||'Работа мастера')} — фото ${i+1}" loading="${i?'lazy':'eager'}">`).join('')}</div>${photos.length>1?`<div class="gallery-controls"><button class="icon-button" data-action="gallery" data-step="-1" aria-label="Предыдущее фото">←</button><span class="gallery-count" aria-live="polite">1 / ${photos.length}</span><button class="icon-button" data-action="gallery" data-step="1" aria-label="Следующее фото">→</button></div>`:''}</div>`;
  }
  function badges(work) {
    return `<span class="photo-badges">${work.pinned?'<span>Закреплено</span>':''}${work.images?.length>1?`<span>${icon('image')} ${work.images.length}</span>`:''}</span>`;
  }
  function studioTile(work,index,list) {
    const canMove = offset => list[index+offset] && Boolean(list[index+offset].pinned) === Boolean(work.pinned);
    return `<figure class="editable-work"><a href="/w/${work.id}" data-route><img src="${esc(work.image)}" alt="${esc(work.caption||'Работа мастера')}" loading="lazy">${badges(work)}</a><figcaption>${esc(work.caption||'Без подписи')}</figcaption><div class="work-tools"><button class="text-button" data-action="edit-work" data-id="${work.id}">Изменить</button><button class="text-button" data-action="pin-work" data-id="${work.id}" aria-pressed="${Boolean(work.pinned)}">${work.pinned?'Открепить':'Закрепить'}</button><button class="icon-button" data-action="move-work" data-id="${work.id}" data-step="-1" aria-label="Поднять работу" ${canMove(-1)?'':'disabled'}>↑</button><button class="icon-button" data-action="move-work" data-id="${work.id}" data-step="1" aria-label="Опустить работу" ${canMove(1)?'':'disabled'}>↓</button><button class="icon-button" data-action="delete-work" data-id="${work.id}" aria-label="Удалить работу">${icon('close')}</button></div></figure>`;
  }
  function editor(work,services) {
    disposeEditor();
    editorPhotos = (work?.images||[]).map(p=>({...p}));
    return `<form data-form="publication" data-id="${work?.id||''}"><p class="muted">До 6 фотографий. Первая — обложка публикации. Меняйте порядок стрелками.</p><div id="photo-editor">${photoEditor()}</div><label class="upload-zone">${icon('image')}<span>Добавить фотографии</span><small>JPEG, PNG, WebP · до 8 МБ каждая</small><input type="file" name="photos" accept="image/jpeg,image/png,image/webp" multiple></label><label class="field">Подпись<textarea aria-label="Подпись" name="caption" maxlength="500" rows="3" placeholder="Расскажите об этой работе">${esc(work?.caption||'')}</textarea></label><label class="field">Связанная услуга<select name="service_id"><option value="">Без привязки</option>${services.map(s=>`<option value="${s.id}" ${work?.service_id===s.id?'selected':''}>${esc(s.name)} · ${money(s.price)}</option>`).join('')}</select></label><p class="form-error" role="alert"></p><button class="button full" type="submit">${work?'Сохранить работу':'Опубликовать работу'} ${icon('check')}</button></form>`;
  }
  function photoEditor() {
    return editorPhotos.length?`<div class="photo-editor-grid">${editorPhotos.map((p,i)=>`<div class="editor-photo"><img src="${esc(p.image)}" alt="Фото ${i+1}"><span>${i===0?'Обложка':`Фото ${i+1}`}</span><div><button type="button" data-action="photo-move" data-index="${i}" data-step="-1" aria-label="Фото ${i+1} раньше" ${i?'':'disabled'}>←</button><button type="button" data-action="photo-move" data-index="${i}" data-step="1" aria-label="Фото ${i+1} позже" ${i===editorPhotos.length-1?'disabled':''}>→</button><button type="button" data-action="photo-remove" data-index="${i}" aria-label="Убрать фото ${i+1}">×</button></div></div>`).join('')}</div>`:'<p class="hint">Выберите фотографии для публикации.</p>';
  }
  function editAction(action,button) {
    const i=Number(button.dataset.index);
    if(action==='photo-remove') {
      const [photo]=editorPhotos.splice(i,1);
      if(photo?.file)URL.revokeObjectURL(photo.image);
    } else {
      const to=i+Number(button.dataset.step);
      if(to>=0&&to<editorPhotos.length)[editorPhotos[i],editorPhotos[to]]=[editorPhotos[to],editorPhotos[i]];
    }
    document.querySelector('#photo-editor').innerHTML=photoEditor();
  }
  function addPhotos(input) {
    const files=[...input.files];
    input.value='';
    if(editorPhotos.length+files.length>6)throw Error('В работе может быть до 6 фотографий');
    if(files.some(f=>f.size>8*1024*1024))throw Error('Каждая фотография должна быть меньше 8 МБ');
    if(files.some(f=>!['image/jpeg','image/png','image/webp'].includes(f.type)))throw Error('Выберите JPEG, PNG или WebP');
    files.forEach(file=>editorPhotos.push({file,image:URL.createObjectURL(file)}));
    document.querySelector('#photo-editor').innerHTML=photoEditor();
  }
  function formData(form) {
    if(!editorPhotos.length)throw Error('Добавьте хотя бы одну фотографию');
    const data=new FormData();
    data.set('caption',form.elements.caption.value);
    data.set('service_id',form.elements.service_id.value);
    data.set('existing_images',JSON.stringify(editorPhotos.filter(p=>!p.file).map(p=>p.id)));
    // The server uses this order to interleave retained and newly uploaded images.
    data.set('photo_order',JSON.stringify(editorPhotos.map(p=>p.file?{upload:editorPhotos.filter(q=>q.file).indexOf(p)}:{id:p.id})));
    editorPhotos.filter(p=>p.file).forEach(p=>data.append('image',p.file));
    return data;
  }
  function feedCard(work) {
    return `<article class="feed-card" data-work-id="${work.id}"><header class="feed-card-head"><a class="work-master" href="/m/${esc(work.slug)}" data-route><div class="avatar">${work.avatar?`<img src="${esc(work.avatar)}" alt="" loading="lazy">`:esc(work.master_name[0])}</div><div><strong>${esc(work.master_name)}</strong><span>${esc(work.city)} · ${new Date(work.created).toLocaleDateString('ru-RU',{day:'numeric',month:'long'})}</span></div></a>${work.is_demo?'<span class="demo-label">Пример</span>':''}</header>${gallery(work)}<div class="feed-card-copy"><a href="/w/${work.id}" data-route><h2>${esc(work.caption||'Новая работа')}</h2></a>${work.service_name?`<p class="feed-service">${esc(work.service_name)} <span>${money(work.service_price)} · ${work.service_duration} мин</span></p>`:''}<div class="feed-actions"><button class="button secondary small ${work.saved?'selected-action':''}" data-action="save-work" data-id="${work.id}" data-saved="${work.saved?'1':'0'}">${icon('heart')} ${work.saved?'Сохранено':'Сохранить'}</button><button class="icon-button" data-action="share" data-url="/w/${work.id}" aria-label="Поделиться работой">${icon('share')}</button>${work.is_demo?`<a class="button small" href="/w/${work.id}" data-route>Смотреть ${icon('arrow')}</a>`:`<button class="button small" data-action="book" data-master="${work.user_id}" data-service="${work.service_id||''}" data-work="${work.id}">Хочу так же ${icon('arrow')}</button>`}</div></div></article>`;
  }
  function inspirationCard(work,index) {
    return `<article class="inspiration-card inspiration-card-${index%7}"><a href="/w/${work.id}" data-route class="inspiration-image"><img src="${esc(work.image)}" alt="${esc(work.caption||'Работа мастера')}" loading="lazy">${badges(work)}<span class="inspiration-open">Смотреть работу ${icon('arrow')}</span></a><div class="inspiration-copy"><a href="/m/${esc(work.slug)}" data-route class="inspiration-master"><span>${esc(work.master_name)}</span><small>${esc(work.category)} · ${esc(work.city)}</small></a><div class="inspiration-actions">${work.is_demo?'<span class="demo-label">Пример</span>':`<button class="icon-button ${work.saved?'selected-action':''}" data-action="save-work" data-id="${work.id}" data-saved="${work.saved?'1':'0'}" aria-label="${work.saved?'Убрать из сохранённых':'Сохранить работу'}">${icon('heart')}</button>`}</div></div>${work.caption?`<p>${esc(work.caption)}</p>`:''}${work.service_name?`<span class="inspiration-service">${esc(work.service_name)} · ${money(work.service_price)}</span>`:''}</article>`;
  }
  return {gallery,badges,studioTile,editor,editAction,addPhotos,formData,disposeEditor,feedCard,inspirationCard};
}
