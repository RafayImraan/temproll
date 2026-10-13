use poseidon::poseidon::bn254::hash_2;

fn salary_commitment(salary: u64) -> Field {
    let domain: Field = 0x54414e44454d5f504159524f4c4c5f31;
    hash_2([domain, salary as Field])
}

fn main(salary: u64, cap: pub u64, commitment: pub Field) {
    assert(salary <= cap);
    assert(salary_commitment(salary) == commitment);
}

#[test]
fn valid_salary_and_commitment() {
    let salary = 4200;
    main(salary, 5000, salary_commitment(salary));
}

#[test(should_fail)]
fn salary_above_cap_is_rejected() {
    let salary = 5001;
    main(salary, 5000, salary_commitment(salary));
}

#[test(should_fail)]
fn altered_commitment_is_rejected() {
    main(4200, 5000, 1);
}
