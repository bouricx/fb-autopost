import { expect,it } from 'vitest';
import { desktopBounds } from '../electron/core/window-bounds';
it('fits the available desktop including smaller scaled displays',()=>{
 for(const size of [{width:1920,height:1040},{width:1024,height:640},{width:768,height:540}]){
  const bounds=desktopBounds(size);expect(bounds.width).toBeLessThanOrEqual(size.width);expect(bounds.height).toBeLessThanOrEqual(size.height);expect(bounds.minWidth).toBeLessThanOrEqual(bounds.width);expect(bounds.minHeight).toBeLessThanOrEqual(bounds.height);
 }
});
