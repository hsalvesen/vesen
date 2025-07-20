export const companyLogos = {
  tiktok: `                id00001        
               i6EAAAIW       
               i6EAAAAIR      
               i6EAAAAAAN     
               i6EAAAAAAAEWdd 
               i6EAAAAAAAAAAIR 
       iddidi  i6EAAARNIAAAAIR 
    ddd6REAAEWWi6EAAAWW WWWWRW 
  dddRAAAAAAEWWi6EAAARW       
 id0EAAAAEIIIWWi6EAAARW       
 d0EAAAIRWWWWW i6EAAARW       
 dWAAAEWW      i6EAAAWW       
 dNAAAEWW      d6AAAAWW       
 dRAAAAEN    idd1AAANWW       
  6EAAAAAN0ddd6IAAAERW        
   WAAAAAAAAAAAAAAIWW         
     IEAAAAAAAAANRWW          
       WWWRRRWWWWW            `,

  deloitte: `                mNNNNNNNNNRR1dmv                           
                iAAAAAAAAAAAAAAAENi                        
                iAAAAAAAAAAAAAAAAAAEd                      
                iAAAAAAAWWRIEAAAAAAAAR                     
                iAAAAAAE     v1AAAAAAAW                    
                iAAAAAAE       WAAAAAAIv                   
                iAAAAAAE       6EAAAAAIi                   
                iAAAAAAE       dIAAAAAEd                   
                iAAAAAAE       6EAAAAAIm                   
                iAAAAAAE       WAAAAAAIv                   
                iAAAAAAE      6AAAAAAE6   md00di           
                iAAAAAAErrr0NAAAAAAAAW  vd00d000dv         
                iAAAAAAAAAAAAAAAAAAEi   rd00d00ddm         
                iAAAAAAAAAAAAAAAEIi     vid00d00dv         
                iIIIIIIIIIIIIN6m          ridddr           `,

  amazon: `                     zyjRKKKM0vz                   
                   vUHHHHHHHHHHHQv                 
                  kHHHHHLX3QIHHHHJy                
                 zPHHHHo    tIHHHHf                
                        zzzyvJHHHHd                
                   zyYJHHHHHHHHHHHd                
                  qKHHHHH1cimIHHHHd                
                 tHHHHH5    xIHHHHd                
                 aHHHHHv    0HHHHH9                
                 eHHHHHLszuUHHHHHHHg               
                  1HHHHHHHHHH7HHHHH8               
        zzz       zu5IHHHHZnz z2Ijz  zyqppqz       
         xhlwzz                     zyzzzxgv       
           zrgghluzz            zzztkhgozogz       
              zvnhgggggggggggggggggltz  xm         
                   zzyvsomlnsvyzz                  `,

  optiver: `                          m1116                           
                         r111116                          
                        v6111111d                         
                        011111111i                        
                       i1111111111i                       
                      r111111111111r                      
                     v1111v 11111111r                     
                     0111i  v11111111v                    
                    i111d    r11111116                    
                   v1111v     m11111116                   
                  v1111v       d11111110                  
                  0111i         01111111i                 
                 i1110           61111111i                
                r1111111111111111111111111m               
                611111111111111111111111111v              `,

  accenture: `          yxz                                  
          qXZ5evzz                             
          qXWWWWWV6tzz                         
          qXWWWWWWWWWW4kry                     
          qXWWWWWWWWWWWWWW1bkwz                
          yp8WWWWWWWWWWWWWWWWWX2buz            
              ztc1YWWWWWWWWWWWWWWWWX7pwzz      
                  zvla3WWWWWWWWWWWWWWWW3w      
                      zxri6XWWWWWWWWWWW3w      
                          zyo3WWWWWWWWW3w      
                     zxsj6WWWWWWWWWWWWW3w      
                 zvmc3WWWWWWWWWWWWWWWWW7x      
             ztd3YWWWWWWWWWWWWWWWWX7nuzz       
          v9WWWWWWWWWWWWWWWWWXZauz             
          qXWWWWWWWWWWWWW1ajwz                 
          qXWWWWWWWWW5jpxz                     
          qXWWWWV9tyzzz                        
          q13dvz                               
          zz                                   `
};

export function getCompanyLogo(company: string): string {
  const normalizedCompany = company.toLowerCase().replace(/\s+/g, '');
  return companyLogos[normalizedCompany as keyof typeof companyLogos] || '';
}