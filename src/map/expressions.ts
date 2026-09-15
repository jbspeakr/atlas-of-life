import type { ExpressionSpecification } from 'maplibre-gl';
export const bands:Record<'country'|'region'|'pin',ExpressionSpecification>={
 country:['interpolate',['linear'],['zoom'],0,.8,2.75,.8,4.25,.08,6,.025,16,.025],
 region:['interpolate',['linear'],['zoom'],0,0,2.75,0,4.25,.7,5.75,.7,7.25,.08,16,.08],
 pin:['interpolate',['linear'],['zoom'],0,0,5.75,0,7.25,1,16,1]
};
export function withVisibility(band:ExpressionSpecification):ExpressionSpecification {
 const result=structuredClone(band);for(let i=4;i<result.length;i+=2)result[i]=['*',result[i],['coalesce',['feature-state','visibility'],1]];return result;
}
