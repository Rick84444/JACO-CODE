#!/usr/bin/env python3
"""Compact-support landmark deformation for offline fitting.
This is a numerical primitive, not an automatic photo-to-human generator.
Coordinates must be registered to the source mesh's local coordinate system.
"""
import math

def distance(a,b):
    return math.sqrt(sum((x-y)**2 for x,y in zip(a,b)))

def kernel(d,radius):
    q=max(0.,1.-d/radius)
    return q**4*(4.*d/radius+1.)

def solve(a,b):
    m=[list(row)+list(rhs) for row,rhs in zip(a,b)]
    n=len(m)
    for k in range(n):
        pivot=max(range(k,n),key=lambda i:abs(m[i][k]))
        if abs(m[pivot][k])<1e-12: raise ValueError("singular control system")
        m[k],m[pivot]=m[pivot],m[k]
        factor=m[k][k];m[k]=[x/factor for x in m[k]]
        for i in range(n):
            if i==k:continue
            factor=m[i][k]
            m[i]=[x-factor*y for x,y in zip(m[i],m[k])]
    return [row[n:] for row in m]

def build_field(source,target,*,radius,max_shift,axes=(0,1),regularization=1e-5):
    """Fit local landmarks, including fixed anchors (source == target).
    Default only permits image-plane movement; never infer profile depth.
    """
    if len(source)!=len(target) or not 4<=len(source)<=128:raise ValueError("control count")
    if not all(len(p)==3 and all(math.isfinite(x) for x in p) for p in list(source)+list(target)):
        raise ValueError("invalid control coordinates")
    if not math.isfinite(radius) or not math.isfinite(max_shift) or min(radius,max_shift)<=0:
        raise ValueError("invalid displacement budget")
    if not math.isfinite(regularization) or not 0<regularization<=.1:raise ValueError("regularization")
    if not axes or len(set(axes))!=len(axes) or any(x not in (0,1,2) for x in axes):raise ValueError("axes")
    if any(distance(p,q)<radius*1e-6 for i,p in enumerate(source) for q in source[i+1:]):
        raise ValueError("duplicate controls")
    offsets=[tuple(t[k]-s[k] if k in axes else 0. for k in range(3)) for s,t in zip(source,target)]
    if any(distance(p,(0,0,0))>max_shift for p in offsets):raise ValueError("landmark shift exceeds budget")
    a=[[kernel(distance(p,q),radius)+(regularization if i==j else 0.) for j,q in enumerate(source)] for i,p in enumerate(source)]
    weights=solve(a,offsets)
    def warp(p):
        if len(p)!=3 or not all(math.isfinite(x) for x in p):raise ValueError("invalid vertex")
        factors=[kernel(distance(p,q),radius) for q in source]
        d=[sum(f*w[k] for f,w in zip(factors,weights)) for k in range(3)]
        if distance(d,(0,0,0))>max_shift:raise ValueError("interpolated shift exceeds budget")
        return tuple(p[k]+d[k] for k in range(3))
    return warp

def transport_morph(base,delta,warp):
    """Push each original expression through the same deformation.
    New delta = F(base + delta) - F(base); zero delta stays exactly zero.
    """
    if len(base)!=len(delta):raise ValueError("morph length mismatch")
    result=[]
    for p,d in zip(base,delta):
        if len(d)!=3 or not all(math.isfinite(x) for x in d):raise ValueError("invalid morph")
        if not any(d):result.append((0.,0.,0.));continue
        a=warp(p); b=warp(tuple(x+y for x,y in zip(p,d)))
        result.append(tuple(y-x for x,y in zip(a,b)))
    return result

def landmark_error(source,target,warp,axes=(0,1)):
    if len(source)!=len(target) or not source:raise ValueError("landmark count")
    return math.sqrt(sum(sum((warp(p)[k]-q[k])**2 for k in axes) for p,q in zip(source,target))/len(source))
