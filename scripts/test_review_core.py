import math
import unittest
from brep_review_core import compare_geometry

class ReviewTests(unittest.TestCase):
    def facts(self):
        return {"volume":1000,"solidCount":1,"bbox":[10,10,10],"boundsMin":[0,0,0],"boundsMax":[10,10,10],"center":[5,5,5]}
    def test_equal(self):
        self.assertTrue(compare_geometry(self.facts(),self.facts())["valid"])
    def test_same_volume_translation(self):
        changed=self.facts();changed["boundsMin"]=[1,0,0];changed["boundsMax"]=[11,10,10];changed["center"]=[6,5,5]
        self.assertFalse(compare_geometry(self.facts(),changed)["valid"])
    def test_negative_and_nonfinite(self):
        for value in [-1,math.nan,math.inf]:
            changed=self.facts();changed["volume"]=value
            self.assertFalse(compare_geometry(self.facts(),changed)["valid"])
    def test_missing(self):
        self.assertFalse(compare_geometry(None,self.facts())["valid"])

if __name__=="__main__":unittest.main()
