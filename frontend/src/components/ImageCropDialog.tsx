import {createPortal} from 'react-dom';
import {useEffect,useRef,useState,type PointerEvent} from 'react';
import {X} from 'lucide-react';
import type {ImageKind} from '../lib/imageUpload';
import '../image-editor.css';

type Crop={x:number;y:number;size:number};
const clamp=(n:number,min:number,max:number)=>Math.max(min,Math.min(max,n));
export function ImageCropDialog({file,kind,busy=false,error='',onCancel,onSave}:{file:File;kind:ImageKind;busy?:boolean;error?:string;onCancel:()=>void;onSave:(file:File)=>Promise<boolean>|boolean}){
  const dialog=useRef<HTMLDialogElement>(null),stage=useRef<HTMLDivElement>(null),img=useRef<HTMLImageElement>(null);
  const [url,setUrl]=useState(''),[dimensions,setDimensions]=useState({width:0,height:0}),[bounds,setBounds]=useState({width:1,height:1});
  const [crop,setCrop]=useState<Crop>({x:0,y:0,size:0}),[preparing,setPreparing]=useState(false),[localError,setLocalError]=useState('');
  const operation=useRef(false),drag=useRef<{clientX:number;clientY:number;crop:Crop}|null>(null);
  const aspect=kind==='avatar'?1:16/9,minSize=kind==='avatar'?256:800;
  const scale=dimensions.width?Math.min(bounds.width/dimensions.width,bounds.height/dimensions.height):1;
  const left=(bounds.width-dimensions.width*scale)/2,top=(bounds.height-dimensions.height*scale)/2;
  const waiting=busy||preparing;
  useEffect(()=>{const next=URL.createObjectURL(file);setUrl(next);return()=>URL.revokeObjectURL(next)},[file]);
  useEffect(()=>{
    const surface=dialog.current;if(!surface)return;
    const body=document.body,root=document.documentElement,scroll=window.scrollY,saved={position:body.style.position,top:body.style.top,width:body.style.width,overflow:root.style.overflow};
    body.style.position='fixed';body.style.top=-scroll+'px';body.style.width='100%';root.style.overflow='hidden';surface.showModal();
    return()=>{surface.close();body.style.position=saved.position;body.style.top=saved.top;body.style.width=saved.width;root.style.overflow=saved.overflow;window.scrollTo(0,scroll)};
  },[]);
  useEffect(()=>{const node=stage.current;if(!node)return;const observer=new ResizeObserver(entries=>{const b=entries[0].contentRect;setBounds({width:b.width,height:b.height})});observer.observe(node);return()=>observer.disconnect()},[]);
  function loaded(){const image=img.current;if(!image)return;const width=image.naturalWidth,height=image.naturalHeight,size=Math.min(width,height*aspect);setDimensions({width,height});setCrop({x:(width-size)/2,y:(height-size/aspect)/2,size})}
  function start(event:PointerEvent<HTMLElement>){
    if(waiting||!crop.size)return;event.preventDefault();event.stopPropagation();event.currentTarget.setPointerCapture(event.pointerId);drag.current={clientX:event.clientX,clientY:event.clientY,crop};
  }
  function move(event:PointerEvent<HTMLElement>){
    const before=drag.current;if(!before||waiting)return;
    const dx=(event.clientX-before.clientX)/scale,dy=(event.clientY-before.clientY)/scale;
    setCrop({
      ...before.crop,
      x:clamp(before.crop.x+dx,0,dimensions.width-before.crop.size),
      y:clamp(before.crop.y+dy,0,dimensions.height-before.crop.size/aspect)
    });
  }
  async function save(){
    if(operation.current||!img.current||!crop.size)return;operation.current=true;setPreparing(true);setLocalError('');
    try{
      const canvas=document.createElement('canvas');canvas.width=Math.round(Math.min(kind==='avatar'?800:1600,crop.size));canvas.height=Math.round(canvas.width/aspect);
      const context=canvas.getContext('2d');if(!context)throw Error('Не удалось подготовить фото');
      context.drawImage(img.current,crop.x,crop.y,crop.size,crop.size/aspect,0,0,canvas.width,canvas.height);
      const blob=await new Promise<Blob>((resolve,reject)=>canvas.toBlob(value=>value?resolve(value):reject(Error('Не удалось подготовить фото')),'image/webp',.9));
      await onSave(new File([blob],kind+'-frame.webp',{type:'image/webp'}));
    }catch(reason){setLocalError(reason instanceof Error?reason.message:'Не удалось сохранить кадр')}
    finally{operation.current=false;setPreparing(false)}
  }
  return createPortal(<dialog className="image-crop-dialog" ref={dialog} aria-labelledby="image-crop-title" onCancel={event=>{event.preventDefault();if(!waiting)onCancel()}}><div className="image-editor-heading"><h2 id="image-crop-title">{kind==='avatar'?'Выберите область аватара':'Расположите обложку'}</h2><button type="button" aria-label="Закрыть редактор фото" disabled={waiting} onClick={onCancel}><X size={20}/></button></div><p>Перемещайте {kind==='avatar'?'круг':'рамку'} по фото. Размер настраивается ползунком ниже.</p><div className="image-crop-stage" ref={stage}><img ref={img} src={url||undefined} alt="Выбранная фотография" onLoad={loaded} draggable={false}/>{crop.size?<div className={'image-crop-frame '+(kind==='avatar'?'is-circle':'')} style={{left:left+crop.x*scale,top:top+crop.y*scale,width:crop.size*scale,height:crop.size/aspect*scale}} onPointerDown={start} onPointerMove={move} onPointerUp={()=>{drag.current=null}} onPointerCancel={()=>{drag.current=null}}/>:null}</div><fieldset disabled={waiting||!crop.size} className="image-crop-sliders"><label>Размер области<input type="range" min={minSize} max={Math.max(minSize,Math.min(dimensions.width,dimensions.height*aspect))} step="1" value={crop.size||minSize} onChange={e=>{const size=Number(e.target.value);setCrop(c=>{const delta=size-c.size;return{size,x:clamp(c.x-delta/2,0,dimensions.width-size),y:clamp(c.y-(delta/aspect)/2,0,dimensions.height-size/aspect)}})}}/></label><details><summary>Точное положение</summary><label>По горизонтали<input type="range" min="0" max={Math.max(0,dimensions.width-crop.size)} value={crop.x} onChange={e=>setCrop(c=>({...c,x:Number(e.target.value)}))}/></label><label>По вертикали<input type="range" min="0" max={Math.max(0,dimensions.height-crop.size/aspect)} value={crop.y} onChange={e=>setCrop(c=>({...c,y:Number(e.target.value)}))}/></label></details></fieldset>{error||localError?<p role="alert" className="form-error">{error||localError}</p>:null}<div className="image-editor-actions"><button type="button" className="button button-outline" disabled={waiting} onClick={onCancel}>Отмена</button><button type="button" className="button button-wine" disabled={waiting||!crop.size} onClick={()=>void save()}>{waiting?'Сохраняем…':'Сохранить фото'}</button></div></dialog>,document.body);
}
