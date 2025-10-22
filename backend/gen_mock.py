import random
from datetime import datetime, timedelta
import pyarrow as pa

FIRST = ["Alex","Sam","Taylor","Jordan","Priya","Wei","Ana","Noah","Liam","Maya","Ethan","Zoe","Iris","Kai","Mina"]
LAST  = ["Lee","Patel","Nguyen","Garcia","Smith","Chen","Yamada","Hernandez","Ivanov","Khan","Novak","Bauer","Silva","Kowalski","Nasser"]
TITLES = ["Backend Engineer","Full-stack Dev","Data Engineer","SRE","ML Engineer","iOS Dev","Android Dev","Frontend Engineer"]
SKILLS = ["python","go","ts","react","kubernetes","postgres","redis","aws","gcp","azure","rust","java","docker"]
LOC    = ["Remote","London","San Francisco","New York","Berlin","Bangalore","Toronto","Sydney","Dublin"]

random.seed(7)
N = 250_000  # change to 100_000 if your laptop is modest

def rand_name(): return random.choice(FIRST) + " " + random.choice(LAST)
def rand_skills(): return ",".join(sorted(random.sample(SKILLS, k=random.randint(3,6))))

def arrow_table(n=N):
    now = datetime.utcnow()
    return pa.table({
        "id": pa.array(range(n), type=pa.int32()),
        "name": pa.array([rand_name() for _ in range(n)]),
        "title": pa.array([random.choice(TITLES) for _ in range(n)]),
        "location": pa.array([random.choice(LOC) for _ in range(n)]),
        "years_exp": pa.array([random.randint(1, 20) for _ in range(n)], type=pa.int8()),
        "skills": pa.array([rand_skills() for _ in range(n)]),
        "comp": pa.array([random.randint(50_000, 250_000) for _ in range(n)], type=pa.int32()),
        "last_active": pa.array([(now - timedelta(days=random.randint(0, 365))).isoformat() for _ in range(n)])
    })

if __name__ == "__main__":
    tbl = arrow_table()
    with pa.OSFile("/tmp/candidates.arrow", "wb") as f:
        with pa.RecordBatchFileWriter(f, tbl.schema) as w:
            w.write_table(tbl)
    print("Wrote /tmp/candidates.arrow")
