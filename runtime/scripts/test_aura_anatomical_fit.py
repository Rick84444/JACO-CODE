import unittest, struct, json
from aura_landmark_fit import build_field, transport_morph, landmark_error
from aura_anatomical_source import read_glb, positions, audit

class FitTest(unittest.TestCase):
    def setUp(self):
        self.src=[(-.03,0.,.04),(.03,0.,.04),(0.,-.04,.05),(0.,.04,.02)]
        self.target=[(-.032,0.,.04),(.032,0.,.04),(0.,-.037,.05),(0.,.04,.02)]
    def test_registered_front_fit(self):
        f=build_field(self.src,self.target,radius=.07,max_shift=.01)
        before=landmark_error(self.src,self.target,lambda x:x)
        self.assertLess(landmark_error(self.src,self.target,f),before*.001)
        self.assertEqual(f((0.,-1.,0.)),(0.,-1.,0.))
        for p in self.src:self.assertEqual(f(p)[2],p[2])
    def test_transport(self):
        f=build_field(self.src,self.target,radius=.07,max_shift=.01)
        delta=[(0.,.002,0.),(0.,0.,0.),(.001,-.002,.001),(0.,0.,0.)]
        out=transport_morph(self.src,delta,f)
        for p,d,n in zip(self.src,delta,out):
            base=f(p);posed=f(tuple(a+b for a,b in zip(p,d)))
            for a,b in zip(tuple(x+y for x,y in zip(base,n)),posed):self.assertAlmostEqual(a,b,places=12)
        self.assertEqual(out[1],(0.,0.,0.))
    def test_fail_closed(self):
        with self.assertRaises(ValueError):build_field(self.src,self.target,radius=.07,max_shift=.00001)
        with self.assertRaises(ValueError):build_field([self.src[0]]*4,self.target,radius=.07,max_shift=.01)
        with self.assertRaises(ValueError):audit(b"invalid")
    def test_sparse_morph(self):
        raw=bytes([1])+b"\x00"*3+struct.pack("<fff",.01,.02,.03)
        doc={"bufferViews":[{"buffer":0,"byteOffset":0,"byteLength":1},{"buffer":0,"byteOffset":4,"byteLength":12}],"accessors":[{"type":"VEC3","componentType":5126,"count":3,"sparse":{"count":1,"indices":{"bufferView":0,"componentType":5121},"values":{"bufferView":1}}}]}
        p=positions(doc,raw,0)
        self.assertEqual(p[0],(0.,0.,0.))
        self.assertAlmostEqual(p[1][2],.03)
        self.assertEqual(p[2],(0.,0.,0.))
        with self.assertRaises(ValueError):positions(doc,bytes([9])+raw[1:],0)

if __name__=="__main__":unittest.main()
