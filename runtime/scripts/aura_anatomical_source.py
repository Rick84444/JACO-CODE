#!/usr/bin/env python3
"""Offline anatomical GLB inspection. Standard library only; does not modify the source."""
import argparse, hashlib, json, math, struct
from pathlib import Path
from html import escape

PIN_SIZE=36815920
PIN_BLOB="cd2ebbe1fe8bcbf3d5b2dfbf1262a7f76814e68f"
REQUIRED={"jawOpen","eyeBlinkLeft","eyeBlinkRight","viseme_aa","viseme_O"}

def read_glb(data):
    if len(data)<20 or struct.unpack_from("<4sII",data)!=(b"glTF",2,len(data)):
        raise ValueError("invalid GLB header")
    chunks={}; p=12
    while p<len(data):
        if p+8>len(data): raise ValueError("invalid chunk header")
        n,k=struct.unpack_from("<I4s",data,p); p+=8
        if n%4 or p+n>len(data) or k in chunks: raise ValueError("invalid GLB chunk")
        chunks[k]=data[p:p+n];p+=n
    return json.loads(chunks[b"JSON"]),chunks[b"BIN\x00"]

def view_bytes(doc, binary, index):
    v=doc["bufferViews"][index]
    o=v.get("byteOffset",0); n=v["byteLength"]
    if v.get("buffer",0)!=0 or min(o,n)<0 or o+n>len(binary): raise ValueError("invalid buffer view")
    return memoryview(binary)[o:o+n],v

def positions(doc,binary,index):
    a=doc["accessors"][index]; count=a["count"]
    if a["type"]!="VEC3" or a["componentType"]!=5126 or count<1 or count>1000000:
        raise ValueError("expected bounded FLOAT VEC3 positions")
    result=[(0.,0.,0.)]*count
    if "bufferView" in a:
        b,v=view_bytes(doc,binary,a["bufferView"]); offset=a.get("byteOffset",0); stride=v.get("byteStride",12)
        if stride<12 or offset<0 or offset+(count-1)*stride+12>len(b): raise ValueError("position bounds")
        result=[struct.unpack_from("<fff",b,offset+i*stride) for i in range(count)]
    if "sparse" in a:
        s=a["sparse"]; n=s["count"]; ix=s["indices"]; val=s["values"]
        b,_=view_bytes(doc,binary,ix["bufferView"]); vb,_=view_bytes(doc,binary,val["bufferView"])
        fmt={5121:"B",5123:"H",5125:"I"}[ix["componentType"]]; step=struct.calcsize("<"+fmt)
        io=ix.get("byteOffset",0);vo=val.get("byteOffset",0)
        if not 0<=n<=count or min(io,vo)<0 or io+n*step>len(b) or vo+n*12>len(vb): raise ValueError("sparse bounds")
        prev=-1
        for j in range(n):
            i=struct.unpack_from("<"+fmt,b,io+j*step)[0]
            if i<=prev or i>=count: raise ValueError("sparse index")
            result[i]=struct.unpack_from("<fff",vb,vo+j*12);prev=i
    if not all(math.isfinite(x) for p in result for x in p): raise ValueError("nonfinite position")
    return result

def audit(data,pinned=True):
    blob=hashlib.sha1(b"blob "+str(len(data)).encode()+b"\x00"+data).hexdigest()
    if pinned and (len(data)!=PIN_SIZE or blob!=PIN_BLOB): raise ValueError("source pin mismatch")
    d,b=read_glb(data); meshes=d.get("meshes",[]); nodes=d.get("nodes",[])
    candidates=[]
    for i,m in enumerate(meshes):
        names=m.get("extras",{}).get("targetNames",[])
        for j,p in enumerate(m.get("primitives",[])):
            if REQUIRED.issubset(names) and len(names)==len(p.get("targets",[])):
                candidates.append((i,j,m,p,names))
    if len(candidates)!=1: raise ValueError("expected exactly one canonical face primitive")
    i,j,m,p,names=candidates[0]; a=p["attributes"]
    if not {"POSITION","JOINTS_0","WEIGHTS_0","TEXCOORD_0"}.issubset(a): raise ValueError("missing skin or UV")
    owners=[n for n in nodes if n.get("mesh")==i and "skin" in n]
    if len(owners)!=1: raise ValueError("face skin owner missing or ambiguous")
    skin=d["skins"][owners[0]["skin"]]; joints=[nodes[k].get("name","") for k in skin["joints"]]
    if not {"Head","Neck"}.issubset(joints): raise ValueError("required joints missing")
    base=positions(d,b,a["POSITION"]); morphs={}
    for name in sorted(REQUIRED):
        target=p["targets"][names.index(name)]
        delta=positions(d,b,target["POSITION"])
        if len(delta)!=len(base): raise ValueError("morph length mismatch")
        peak=max(math.sqrt(sum(x*x for x in q)) for q in delta)
        if peak<1e-6: raise ValueError("empty morph: "+name)
        morphs[name]={"nonzero_vertices":sum(any(abs(x)>1e-7 for x in q) for q in delta),"peak_local_units":peak}
    bounds=[[min(q[k] for q in base),max(q[k] for q in base)] for k in range(3)]
    report={"source_git_blob":blob,"sha256":hashlib.sha256(data).hexdigest(),"bytes":len(data),"mesh":m.get("name",""),"primitive":j,"position_accessor":a["POSITION"],"vertices":len(base),"bounds_local":bounds,"skin_joints":joints,"face_morph_count":len(names),"required_morphs":morphs,"mesh_names":[x.get("name","") for x in meshes],"embedded_images":len(d.get("images",[])),"uv_preserved":True,"note":"Source audit only; no photo fitting or visual acceptance."}
    return report,base

def guide_svg(points):
    # This is a geometric projection, not a render with materials. Local axes are explicit.
    ymax=max(p[1] for p in points); ymin=min(p[1] for p in points)
    head=[(i,p) for i,p in enumerate(points) if p[1]>=ymax-(ymax-ymin)*.18]
    if len(head)<30: raise ValueError("head region not identifiable")
    lo=min(p[1] for _,p in head); hi=max(p[1] for _,p in head)
    scale=500/max(hi-lo,1e-6)
    parts=['<svg xmlns="http://www.w3.org/2000/svg" width="1000" height="650" viewBox="0 0 1000 650">','<rect width="1000" height="650" fill="#101c29"/>']
    for off,axis,label in [(250,0,"Front projection X/Y"),(750,2,"Side projection Z/Y")]:
        mid=(min(p[axis] for _,p in head)+max(p[axis] for _,p in head))/2
        parts.append(f'<text x="{off}" y="38" fill="#d9e8f4" text-anchor="middle" font-family="sans-serif" font-size="18">{escape(label)}</text>')
        for i,p in head:
            x=off+(p[axis]-mid)*scale;y=80+(hi-p[1])*scale
            parts.append(f'<circle cx="{x:.2f}" cy="{y:.2f}" r="0.9" fill="#93cced" opacity=".65"><title>vertex {i}: {p[0]:.6f}, {p[1]:.6f}, {p[2]:.6f}</title></circle>')
    parts.append('<text x="500" y="630" fill="#afbeca" text-anchor="middle" font-family="sans-serif" font-size="14">Local coordinates; hover a point for vertex ID. No inferred photo depth.</text></svg>')
    return "".join(parts),head

def main():
    parser=argparse.ArgumentParser();parser.add_argument("source",type=Path);parser.add_argument("--out",type=Path,required=True)
    args=parser.parse_args();report,base=audit(args.source.read_bytes())
    svg,head=guide_svg(base);args.out.mkdir(parents=True,exist_ok=True)
    (args.out/"source-audit.json").write_text(json.dumps(report,indent=2))
    (args.out/"head-landmark-guide.svg").write_text(svg)
    (args.out/"head-vertices.json").write_text(json.dumps([{"vertex":i,"xyz":p} for i,p in head],separators=(",",":")))
    print(json.dumps({k:report[k] for k in ("source_git_blob","vertices","face_morph_count","embedded_images","required_morphs")},indent=2))
if __name__=="__main__":main()
