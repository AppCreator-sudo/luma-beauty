import rules from '../../../lib/image-rules.json';

export type ImageKind = 'avatar' | 'cover';
export const imageUploadAccept = rules.mimeTypes.join(',');
const maxMegabytes = rules.maxBytes / (1024 * 1024);

export function imageUploadHint(kind: ImageKind) {
  const limits = rules[kind];
  const common = `JPG, PNG или WebP · до ${maxMegabytes} МБ. Минимум ${limits.minWidth}×${limits.minHeight} px, рекомендуем ${limits.recommendedWidth}×${limits.recommendedHeight} px.`;
  const framing = kind === 'avatar'
    ? ' Можно вертикальное фото 9:16 — края обрежутся по кругу. Лицо или логотип держите ближе к центру.'
    : ' Горизонтальное фото (лучше 16:9). Важные детали держите ближе к центру: края могут обрезаться.';
  return common + framing + ` До ${rules.maxSide.toLocaleString('ru-RU')} px по стороне, ${rules.maxPixels / 1000000} Мп.`;
}

export async function validateImageUpload(file: File, kind: ImageKind): Promise<{ width: number; height: number }> {
  if (!rules.mimeTypes.includes(file.type)) throw new Error('Выберите фотографию в формате JPG, PNG или WebP.');
  if (file.size === 0) throw new Error('Файл пуст. Выберите другую фотографию.');
  if (file.size > rules.maxBytes) throw new Error(`Размер фотографии не должен превышать ${maxMegabytes} МБ.`);
  const objectUrl = URL.createObjectURL(file);
  try {
    const dimensions = await new Promise<{ width: number; height: number }>((resolve, reject) => {
      const image = new Image();
      image.onload = () => resolve({ width: image.naturalWidth, height: image.naturalHeight });
      image.onerror = () => reject(new Error('Не удалось прочитать фотографию. Выберите другой файл JPG, PNG или WebP.'));
      image.src = objectUrl;
    });
    const { width, height } = dimensions;
    const limits = rules[kind];
    if (width < limits.minWidth || height < limits.minHeight) {
      throw new Error(`Фотография слишком маленькая: ${width}×${height} px. Нужно не менее ${limits.minWidth}×${limits.minHeight} px.`);
    }
    if (width > rules.maxSide || height > rules.maxSide || width * height > rules.maxPixels) {
      throw new Error(`Фотография слишком большая: не более ${rules.maxSide.toLocaleString('ru-RU')} px по стороне и ${rules.maxPixels / 1000000} Мп.`);
    }
    if (kind === 'cover' && rules.cover.landscape && width <= height) {
      throw new Error(`Для обложки выберите горизонтальное фото: ширина должна быть больше высоты. Рекомендуем ${rules.cover.recommendedWidth}×${rules.cover.recommendedHeight} px (16:9).`);
    }
    return dimensions;
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}
